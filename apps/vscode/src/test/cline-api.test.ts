import { afterEach, beforeEach, describe, it } from "mocha"
import * as should from "should"
import * as sinon from "sinon"
import { createClineAPI } from "@/exports"
import { Logger } from "@/shared/services/Logger"
import type { ClineAPI } from "../exports/cline"
import { setVscodeHostProviderMock } from "./host-provider-test-utils"

describe("ClineAPI Core Functionality", () => {
	let api: ClineAPI
	let mockController: any
	let mockLoggerError: sinon.SinonStub
	let sandbox: sinon.SinonSandbox
	let _getGlobalStateStub: sinon.SinonStub

	beforeEach(async () => {
		sandbox = sinon.createSandbox()

		// Stub Logger.error
		mockLoggerError = sandbox.stub(Logger, "error")
		setVscodeHostProviderMock({})

		// Create a mock controller that matches what the real createClineAPI expects
		// We don't import the real Controller to avoid the webview dependencies
		mockController = {
			id: "test-controller-id",
			context: {
				globalState: {
					get: sandbox.stub(),
					update: sandbox.stub(),
					keys: sandbox.stub().returns([]),
					setKeysForSync: sandbox.stub(),
				},
				secrets: {
					get: sandbox.stub(),
					store: sandbox.stub(),
					delete: sandbox.stub(),
					onDidChange: sandbox.stub(),
				},
			},
			updateCustomInstructions: sandbox.stub().resolves(),
			clearTask: sandbox.stub().resolves(),
			postStateToWebview: sandbox.stub().resolves(),
			postMessageToWebview: sandbox.stub().resolves(),
			initTask: sandbox.stub().resolves(),
			task: undefined,
		}

		// Create API instance
		api = createClineAPI(mockController)
	})

	afterEach(() => {
		sandbox.restore()
	})

	describe("startNewTask", () => {})

	describe("sendMessage", () => {})

	describe("Button Press Methods", () => {
		describe("pressSecondaryButton", () => {})
	})

	describe("Error Handling", () => {
		it("should handle errors in task initialization", async () => {
			mockController.initTask.rejects(new Error("Init failed"))

			try {
				await api.startNewTask("test task")
				should.fail("", "", "Should have thrown an error", "")
			} catch (error: any) {
				error.message.should.equal("Init failed")
			}
		})
	})
})
