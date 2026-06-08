import { GlobalFileNames } from "@core/storage/disk";
import { EmptyRequest } from "@shared/proto/cline/common";
import {
	ShengSuanYunCompatibleModelInfo,
	ShengSuanYunModelInfo,
} from "@shared/proto/cline/models";
import { getAxiosSettings } from "@/shared/net";
import { fileExistsAtPath } from "@utils/fs";
import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { Logger } from "@/shared/services/Logger";
import { Controller } from "..";

// export interface EModelInfo {
// 	id: number;
// 	name: string;
// 	type: string;
// 	inputPrice: number;
// 	outputPrice: number;
// 	inputPriceUnit: string;
// 	outputPriceUnit: string;
// 	otherPrice: string;
// 	provider: string;
// 	supportModelId: number;
// 	currency: string;
// 	contextLength: number;
// 	isBYOK: boolean;
// }

export interface Project {
	id: number;
	name: string;
	models: Record<string, Partial<ShengSuanYunModelInfo>>;
}

const BASE_URL = "https://api.shengsuanyun.com";

export async function refreshShengSuanYunEModels(
	controller: Controller,
	_request: EmptyRequest,
): Promise<ShengSuanYunCompatibleModelInfo> {
	const cacheFilePath = path.join(
		await ensureCacheDirectoryExists(controller),
		GlobalFileNames.shengSuanYunEModels,
	);
	const token =
	controller.stateManager.getSecretKey("shengSuanYunToken");
	if (!token) {
		Logger.error("No token found for ShengSuanYun. Cannot refresh models.");
		return ShengSuanYunCompatibleModelInfo.create({ models: {} });
	}
	let models: Record<number, Project> = {};
	try {
		const res = await axios.get(
			`${BASE_URL}project/list`,
			{
				headers: { "x-token": token },
				...getAxiosSettings(),
			},
		);
		if (res.data?.data && Array.isArray(res.data.data)) {
			const exclude = ["embed","seed","video","happyhorse","image","wan","sora","veo","kling","forest","jimeng","vidu","live","director","runway"]
			const excludeTP = ["视频","图像生成","音频","向量"]
			for (const project of res.data.data) {
				let pmodels: Record<string, Partial<ShengSuanYunModelInfo>> = {};
				if (Array.isArray(project.selectedModels) && project.status =="active") {
					for (const model of project.selectedModels) {
						if (exclude.some(ex => model.name.includes(ex)) || excludeTP.some(tp => model.type.includes(tp))) {
							continue;
						}
						pmodels[model.name] = {
							contextWindow: model.contextLength,
							supportsImages: model.type.includes("图像"),
							supportsPromptCache: false,
							inputPrice: model.inputPrice / 10000,
							outputPrice: model.outputPrice / 10000,
							cacheWritesPrice: 0,
							cacheReadsPrice: 0,
							description: `${model.provider} - ${model.name}`,
							endPoints: ["/v1/chat/completions"],
						};
					}
					models[project.id] = {
						id: project.id,
						name: project.projectName,
						models: pmodels,
					};
				}
			}
		}
		await fs.writeFile(cacheFilePath, JSON.stringify(models));
		Logger.log("ShengSuanYun enterprise models fetched and saved", models);
		return ShengSuanYunCompatibleModelInfo.create({ models });
	} catch (error) {
		Logger.error("Error fetching ShengSuanYun enterprise models:", error);
		const cachedModels = await readCachedModels(controller);
		if (cachedModels) {
			models = cachedModels;
		}
	}
	return ShengSuanYunCompatibleModelInfo.create({ models });
}

async function readCachedModels(
	controller: Controller,
): Promise<Record<number, Project> | undefined> {
	const cacheFilePath = path.join(
		await ensureCacheDirectoryExists(controller),
		GlobalFileNames.shengSuanYunEModels,
	);
	if (!(await fileExistsAtPath(cacheFilePath))) {
		return undefined;
	}
	try {
		const contents = await fs.readFile(cacheFilePath, "utf8");
		return JSON.parse(contents);
	} catch (error) {
		Logger.error("Error reading cached ShengSuanYun enterprise models:", error);
		return undefined;
	}
}

async function ensureCacheDirectoryExists(controller: Controller): Promise<string> {
	const cacheDir = path.join(controller.context.globalStorageUri.fsPath, "cache");
	await fs.mkdir(cacheDir, { recursive: true });
	return cacheDir;
}
