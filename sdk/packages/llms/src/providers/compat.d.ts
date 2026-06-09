import type { GatewayStreamRequest } from "@coohu/shared";
import { type ApiHandler, type Message, type ProviderConfig } from "./types";
export declare function toGatewayRequestMessages(messages: Message[]): GatewayStreamRequest["messages"];
export declare function createGatewayApiHandler(config: ProviderConfig): ApiHandler;
export declare function createGatewayApiHandlerAsync(config: ProviderConfig): Promise<ApiHandler>;
