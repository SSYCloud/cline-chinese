import { StringRequest } from "@shared/proto/cline/common"
import * as vscode from "vscode"
import { Uri } from "@/shared/proto/host/uri"

export async function file(request: StringRequest): Promise<Uri> {
	const uri = vscode.Uri.file(request.value)
	return {
		scheme: uri.scheme,
		authority: uri.authority,
		path: uri.path,
		query: uri.query,
		fragment: uri.fragment,
		fsPath: uri.fsPath,
	}
}
