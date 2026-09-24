import { type StringRequest, String as StringResponse } from "@shared/proto/cline/common"
import { z } from "zod"
import type { Controller } from "../index"

export async function skillBotCatalog(controller: Controller, request: StringRequest): Promise<StringResponse> {
	const input = z
		.object({
			action: z.enum(["list", "pin", "unpin"]).default("list"),
			installed: z.boolean().optional(),
			page: z.number().int().min(0).default(0),
			keyword: z.string().max(200).default(""),
			pageToken: z.string().max(2000).default(""),
			id: z.string().max(200).optional(),
		})
		.parse(JSON.parse(request.value || "{}"))
	if (input.action !== "list") {
		if (!input.id) throw new Error("缺少 SkillBot ID。")
		await controller.skillBotDirectory.pin(input.id, input.action === "pin")
	}
	const catalog = await controller.skillBotDirectory.list(input)
	return StringResponse.create({
		value: JSON.stringify({
			...catalog,
			// The installed list is local and can be empty even before sign-in. Tell the UI
			// whether the same credential used by LoomLoomClient is available, never its value.
			authRequired: !controller.stateManager.getSecretKey("shengSuanYunApiKey"),
		}),
	})
}
