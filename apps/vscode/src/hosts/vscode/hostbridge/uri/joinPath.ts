import * as vscode from "vscode";
import { JoinPathRequest, Uri } from "@/shared/proto/host/uri";

export async function joinPath(request: JoinPathRequest): Promise<Uri> {
	const base = request.base;
	if (!base) {
		throw new Error("base URI is required");
	}
	const baseUri = vscode.Uri.from({
		scheme: base.scheme,
		authority: base.authority,
		path: base.path,
		query: base.query,
		fragment: base.fragment,
	});
	const uri = vscode.Uri.joinPath(baseUri, ...request.pathSegments);
	return {
		scheme: uri.scheme,
		authority: uri.authority,
		path: uri.path,
		query: uri.query,
		fragment: uri.fragment,
		fsPath: uri.fsPath,
	};
}
