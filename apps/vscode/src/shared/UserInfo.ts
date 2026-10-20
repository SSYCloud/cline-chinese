export interface UserInfo {
	uid?: string
	displayName?: string
	email?: string
	photoUrl?: string
	appBaseUrl?: string // Cline app base URL
	apiBaseUrl?: string // Base URL for API requests
	balance?: number // ShengSuanYun wallet balance
}
