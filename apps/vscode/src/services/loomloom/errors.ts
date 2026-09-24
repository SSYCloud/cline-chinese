/** Only local checks performed before transport may prove that a request was not sent. */
export class LoomLoomRequestNotSubmittedError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "LoomLoomRequestNotSubmittedError"
	}
}
