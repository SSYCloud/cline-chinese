import { afterEach, beforeEach, describe, it, mock } from "bun:test"
import { Controller } from "@core/controller"
import { BooleanResponse, StringRequest } from "@shared/proto/cline/common"
import * as actualPathUtils from "@utils/path"
import { expect } from "chai"
import * as sinon from "sinon"

// bun loads real ESM, so sinon cannot stub the `@utils/path` namespace export
// ("ES Modules cannot be stubbed"). Inject a module-level sinon stub via
// mock.module so the full sinon stub API keeps working.
const getWorkspacePathStub: sinon.SinonStub = sinon.stub()
const pathUtilsMock = () => ({ ...actualPathUtils, getWorkspacePath: getWorkspacePathStub })
mock.module("@utils/path", pathUtilsMock)
mock.module("@/utils/path", pathUtilsMock)

import { ifFileExistsRelativePath } from "../ifFileExistsRelativePath"

describe("ifFileExistsRelativePath", () => {
	let mockController: Controller

	beforeEach(() => {
		// Create a mock controller
		mockController = {} as any

		// Reset the module-level getWorkspacePath stub
		getWorkspacePathStub.reset()
	})

	afterEach(() => {
		getWorkspacePathStub.reset()
	})

	it("should return false when no workspace path is available", async () => {
		const noWorkspaceScenarios = [null, undefined]

		for (const workspaceValue of noWorkspaceScenarios) {
			getWorkspacePathStub.resolves(workspaceValue)

			const request = StringRequest.create({
				value: "src/test.ts",
			})

			const result = await ifFileExistsRelativePath(mockController, request)

			expect(result).to.deep.equal(BooleanResponse.create({ value: false }))
		}
	})

	it("should return false when path is invalid", async () => {
		getWorkspacePathStub.resolves("/workspace")

		const invalidPaths = ["", undefined]

		for (const invalidPath of invalidPaths) {
			const request = StringRequest.create({
				value: invalidPath,
			})

			const result = await ifFileExistsRelativePath(mockController, request)

			expect(result).to.deep.equal(BooleanResponse.create({ value: false }))
		}
	})
})
