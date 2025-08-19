import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import path from "node:path";
import { readFileSync, existsSync, mkdirSync, createWriteStream } from "node:fs";
import https from "node:https";
import http from "node:http";
import { Client } from "@gradio/client";
// ==================== Schema 定义 ====================
const httpUrlSchema = z
    .string()
    .url({ message: "必须是有效的 URL" })
    .refine((u) => u.startsWith("http://") || u.startsWith("https://"), {
    message: "仅支持 http/https 协议",
});
const imagePathOrUrlSchema = z
    .string()
    .min(1, "image 不能为空")
    .refine((v) => /^https?:\/\//i.test(v) || // http/https URL
    /^[A-Za-z]:[\\\/]/.test(v) || // Windows 绝对路径
    v.startsWith("./") ||
    v.startsWith("../") ||
    v.startsWith("/"), // *nix 绝对路径
{ message: "image 必须是 http(s) URL 或本地路径" });
const englishLabelSchema = z
    .string()
    .max(200, "text_prompt 过长")
    .regex(/^[A-Za-z0-9 .-]*$/, "仅支持英文、空格、点与连字符")
    .default("");
const englishAsciiSchema = z
    .string()
    .min(1, "inpaint_prompt 必填")
    .max(300, "inpaint_prompt 过长")
    .regex(/^[\x20-\x7E]+$/, "仅支持英文 ASCII 可见字符");
const zeroToOneSchema = z
    .coerce
    .number({ invalid_type_error: "必须是数字" })
    .min(0, "最小为 0")
    .max(1, "最大为 1");
// ==================== 工具函数 ====================
class ImageProcessor {
    /**
     * 将本地图片转换为 base64
     */
    static imageToBase64(filePath) {
        const fileBuffer = readFileSync(filePath);
        const ext = path.extname(filePath).toLowerCase();
        let mime = "image/jpeg";
        if (ext === ".png")
            mime = "image/png";
        else if (ext === ".jpg" || ext === ".jpeg")
            mime = "image/jpeg";
        else if (ext === ".gif")
            mime = "image/gif";
        else if (ext === ".webp")
            mime = "image/webp";
        return `data:${mime};base64,${fileBuffer.toString("base64")}`;
    }
    /**
     * 创建透明遮罩
     */
    static createTransparentMask() {
        const transparentPng = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAdgAAAHYBTnsmCAAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAAQSURBVBiVY2AYBaNgFIwAAATgAAFPbxqYAAAAAElFTkSuQmCC";
        return `data:image/png;base64,${transparentPng}`;
    }
    /**
     * 下载文件到本地
     */
    static async downloadFile(fileUrl, outputPath) {
        return new Promise((resolve, reject) => {
            const proto = fileUrl.startsWith("https:") ? https : http;
            const outputDir = path.dirname(outputPath);
            if (!existsSync(outputDir)) {
                mkdirSync(outputDir, { recursive: true });
            }
            proto
                .get(fileUrl, (res) => {
                if ((res.statusCode ?? 0) !== 200) {
                    reject(new Error(`下载失败: ${res.statusCode}`));
                    return;
                }
                const fileStream = createWriteStream(outputPath);
                res.pipe(fileStream);
                fileStream.on("finish", () => {
                    fileStream.close();
                    resolve(outputPath);
                });
                fileStream.on("error", reject);
            })
                .on("error", reject);
        });
    }
    /**
     * 从 URL 获取图片并转换为 base64
     */
    static async fetchUrlAsBase64(url) {
        const isHttps = url.startsWith("https:");
        const client = isHttps ? https : http;
        const options = { method: "GET" };
        return new Promise((resolve, reject) => {
            const req = client.request(url, options, (res) => {
                if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
                    reject(new Error(`下载失败: ${res.statusCode}`));
                    return;
                }
                const chunks = [];
                res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
                res.on("end", () => {
                    const buf = Buffer.concat(chunks);
                    const contentTypeHeader = (res.headers["content-type"] || "").toString().split(";")[0];
                    let mime = contentTypeHeader && contentTypeHeader.startsWith("image/")
                        ? contentTypeHeader
                        : undefined;
                    if (!mime) {
                        const ext = path.extname(new URL(url).pathname).toLowerCase();
                        if (ext === ".png")
                            mime = "image/png";
                        else if (ext === ".jpg" || ext === ".jpeg")
                            mime = "image/jpeg";
                        else if (ext === ".gif")
                            mime = "image/gif";
                        else if (ext === ".webp")
                            mime = "image/webp";
                    }
                    if (!mime)
                        mime = "image/jpeg";
                    resolve(`data:${mime};base64,${buf.toString("base64")}`);
                });
            });
            req.on("error", reject);
            req.end();
        });
    }
    /**
     * 加载图片为 base64 格式
     */
    static async loadImageAsBase64(imageUrlOrPath) {
        if (/^https?:\/\//i.test(imageUrlOrPath)) {
            return await this.fetchUrlAsBase64(imageUrlOrPath);
        }
        return this.imageToBase64(imageUrlOrPath);
    }
}
class GradioClient {
    /**
     * 调用 Gradio API
     */
    static async callApi(endpointUrl, imageUrlOrPath, textPrompt, taskType, options = {}) {
        const client = await Client.connect(endpointUrl);
        try {
            const imageData = imageUrlOrPath.startsWith("data:")
                ? imageUrlOrPath
                : await ImageProcessor.loadImageAsBase64(imageUrlOrPath);
            const payload = [
                { image: imageData, mask: ImageProcessor.createTransparentMask() },
                textPrompt ?? "",
                taskType,
                options.inpaint_prompt ?? "",
                options.box_threshold ?? 0.3,
                options.text_threshold ?? 0.25,
                options.iou_threshold ?? 0.5,
                options.inpaint_mode ?? "merge",
                options.scribble_mode ?? "split",
                options.openai_api_key ?? "",
            ];
            const result = await client.predict(0, payload);
            return result;
        }
        finally {
            await client.close();
        }
    }
    /**
     * 处理 Gradio 结果并保存文件
     */
    static async processResult(result, baseUrl, outputDir) {
        const saved = [];
        if (!result?.data || !Array.isArray(result.data))
            return saved;
        if (!existsSync(outputDir)) {
            mkdirSync(outputDir, { recursive: true });
        }
        for (let i = 0; i < result.data.length; i++) {
            const group = result.data[i];
            if (Array.isArray(group)) {
                for (let j = 0; j < group.length; j++) {
                    const file = group[j];
                    if (file && file.is_file && file.name) {
                        const fileUrl = baseUrl + "/file=" + file.name;
                        const fileName = `result_${i}_${j}_${path.basename(file.name)}`;
                        const full = path.join(outputDir, fileName);
                        await ImageProcessor.downloadFile(fileUrl, full);
                        saved.push(full);
                    }
                }
            }
        }
        return saved;
    }
}
class ResultFormatter {
    /**
     * 格式化保存的文件路径为 file:// 格式
     */
    static formatFilePaths(savedFiles) {
        return savedFiles
            .map((p) => `file://${path.resolve(p).replace(/\\/g, "/")}`)
            .join("\n");
    }
    /**
     * 创建成功响应
     */
    static createSuccessResponse(savedFiles) {
        const fileLines = this.formatFilePaths(savedFiles);
        return {
            content: [
                { type: "text", text: `已保存 ${savedFiles.length} 个结果:\n${fileLines}` },
            ],
        };
    }
    /**
     * 创建错误响应
     */
    static createErrorResponse(message) {
        return {
            content: [{ type: "text", text: message }],
            isError: true,
        };
    }
}
// ==================== 工具注册 ====================
class ToolRegistry {
    constructor(server) {
        this.server = server;
    }
    /**
     * 注册目标检测工具
     */
    registerDetectTool() {
        this.server.registerTool("detect", {
            title: "目标检测（Grounded DINO）",
            description: "基于文本提示做目标检测并渲染框与标签（task_type=det）。注意：text_prompt 仅支持英文（如需中文→英文，请先用系统提示词转换）。",
            inputSchema: {
                endpointUrl: httpUrlSchema.optional(),
                image: imagePathOrUrlSchema.describe("网络图像URL或本地路径"),
                text_prompt: englishLabelSchema.describe("英文目标标签，多个以 ' . ' 分隔（仅支持英文）"),
                box_threshold: zeroToOneSchema.optional().describe("DINO 框过滤阈值，默认0.3"),
                text_threshold: zeroToOneSchema.optional().describe("短语抽取阈值，默认0.25"),
            },
        }, async ({ endpointUrl, image, text_prompt, box_threshold, text_threshold }) => {
            const baseUrl = endpointUrl ?? "http://localhost:7589";
            const result = await GradioClient.callApi(baseUrl, image, text_prompt ?? "", "det", {
                box_threshold,
                text_threshold,
            });
            const saved = await GradioClient.processResult(result, baseUrl, "output/det");
            return ResultFormatter.createSuccessResponse(saved);
        });
    }
    /**
     * 注册语义分割工具
     */
    registerSegmentTool() {
        this.server.registerTool("segment", {
            title: "语义分割（Grounded DINO + SAM）",
            description: "文本引导分割（抠图）：DINO 出框 → SAM 掩码 → 叠加（task_type=seg）。注意：text_prompt 仅支持英文（如需中文→英文，请先用系统提示词转换）。",
            inputSchema: {
                endpointUrl: httpUrlSchema.optional(),
                image: imagePathOrUrlSchema.describe("网络图像URL或本地路径"),
                text_prompt: englishLabelSchema.describe("英文目标标签，多个以 ' . ' 分隔（仅支持英文）"),
                box_threshold: zeroToOneSchema.optional(),
                text_threshold: zeroToOneSchema.optional(),
            },
        }, async ({ endpointUrl, image, text_prompt, box_threshold, text_threshold }) => {
            const baseUrl = endpointUrl ?? "http://localhost:7589";
            const result = await GradioClient.callApi(baseUrl, image, text_prompt ?? "", "seg", {
                box_threshold,
                text_threshold,
            });
            const saved = await GradioClient.processResult(result, baseUrl, "output/segmentation");
            return ResultFormatter.createSuccessResponse(saved);
        });
    }
    /**
     * 注册图像修复工具
     */
    registerInpaintTool() {
        this.server.registerTool("inpaint", {
            title: "文本修复（Stable Diffusion Inpaint）",
            description: "SAM 掩码 + Stable Diffusion 文本修复（task_type=inpainting）。注意：text_prompt 与 inpaint_prompt 仅支持英文（如需中文→英文，请先用系统提示词转换）。",
            inputSchema: {
                endpointUrl: httpUrlSchema.optional(),
                image: imagePathOrUrlSchema.describe("网络图像URL或本地路径"),
                text_prompt: englishLabelSchema.describe("用于定位对象的英文文本（仅支持英文）"),
                inpaint_prompt: englishAsciiSchema.describe("修复成什么样子的英文文本（仅支持英文）"),
                box_threshold: zeroToOneSchema.optional(),
                text_threshold: zeroToOneSchema.optional(),
                inpaint_mode: z.enum(["merge", "first"]).optional().describe("掩码合并或只用第一张，默认 merge"),
            },
        }, async ({ endpointUrl, image, text_prompt, inpaint_prompt, box_threshold, text_threshold, inpaint_mode }) => {
            const baseUrl = endpointUrl ?? "http://localhost:7589";
            if (!inpaint_prompt || inpaint_prompt.trim().length === 0) {
                return ResultFormatter.createErrorResponse("参数 inpaint_prompt 必填");
            }
            const result = await GradioClient.callApi(baseUrl, image, text_prompt ?? "", "inpainting", {
                inpaint_prompt,
                box_threshold,
                text_threshold,
                inpaint_mode: inpaint_mode ?? "merge",
            });
            const saved = await GradioClient.processResult(result, baseUrl, "output/inpainting");
            return ResultFormatter.createSuccessResponse(saved);
        });
    }
    /**
     * 注册系统提示词
     */
    registerSystemPrompt() {
        this.server.registerPrompt("vision-tool-system", {
            title: "视觉工具系统提示",
            description: "将用户需求转为英文参数，规范 text_prompt 标签为 ' . ' 分隔",
            argsSchema: {
                request: z.string().describe("用户的自然语言需求，可能是中文")
            }
        }, ({ request }) => ({
            messages: [
                {
                    role: "assistant",
                    content: {
                        type: "text",
                        text: "You are a parameter generator for an AI vision MCP tool.\n" +
                            "Convert the user's request to English-only parameters.\n" +
                            "- Parameter rules:\n" +
                            "  - text_prompt: English-only target labels. If multiple, separate using ' . ' (space dot space).\n" +
                            "  - inpaint_prompt: English-only description of the desired result.\n" +
                            "  - image: keep original URL/path.\n" +
                            "- Do not include explanations. Output concise English.\n",
                    },
                },
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: `User request:\n${request}\n\nReturn final English-only values for: image, text_prompt (labels separated by ' . '), inpaint_prompt (if needed).`,
                    },
                },
            ],
        }));
    }
    /**
     * 注册所有工具
     */
    registerAllTools() {
        this.registerDetectTool();
        this.registerSegmentTool();
        this.registerInpaintTool();
        this.registerSystemPrompt();
    }
}
// ==================== 主程序 ====================
class MCPVisionServer {
    constructor() {
        this.server = new McpServer({
            name: "demo-server",
            version: "1.0.0",
        });
        this.toolRegistry = new ToolRegistry(this.server);
    }
    /**
     * 启动服务器
     */
    async start() {
        try {
            // 注册所有工具
            this.toolRegistry.registerAllTools();
            // 连接传输层
            const transport = new StdioServerTransport();
            await this.server.connect(transport);
            console.log("MCP Vision Server 启动成功");
        }
        catch (error) {
            console.error("服务器启动失败:", error);
            throw error;
        }
    }
}
// ==================== 程序入口 ====================
async function main() {
    try {
        const visionServer = new MCPVisionServer();
        await visionServer.start();
    }
    catch (error) {
        console.error("Server error:", error);
        process.exit(1);
    }
}
// 启动服务器
main();
