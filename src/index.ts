// src/index.ts
import { Elysia } from 'elysia'
import { Type as t } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { createAccelerator } from 'json-accelerator'

// --- Constants ---
const INVALID_PHONE_NUMBER = 'INVALID_PHONE_NUMBER'
const INVALID_VOUCHER_CODE = 'INVALID_VOUCHER_CODE'
const HTTP_ERROR_PREFIX = 'HTTP_ERROR_'
const INVALID_JSON_RESPONSE = 'INVALID_JSON_RESPONSE'
const NETWORK_ERROR = 'NETWORK_ERROR'

// --- Type Aliases ---

// --- Types ---
const shape = t.Object({
	mobile: t.String(),
	voucher_hash: t.String()
})

export interface RedeemVoucher {
	phoneNumber: string
	voucherCode: string
}

interface VoucherDetails {
	voucher_id: string
	amount_baht: string
	redeemed_amount_baht: string
	member: number
	status: string
	link: string
	detail: string
	expire_date: number
	type: string
	redeemed: number
	available: number
}

interface Profile {
	full_name?: string
	mobile_number?: string
}

interface Ticket {
	mobile: string
	update_date: number
	amount_baht: string
	full_name: string
	profile_pic: string | null
}

interface ApiResponseSuccess {
	status: {
		code: 'SUCCESS'
		message: string
		data: {
			voucher: VoucherDetails
			owner_profile: Profile
			redeemer_profile: Profile
			my_ticket: Ticket
			tickets: Ticket[]
		}
	}
}

interface ApiResponseError {
	status: {
		code: string
		message: string
		error?: any
	}
	data?: null
}

type ApiResponse = Readonly<ApiResponseSuccess> | Readonly<ApiResponseError>

// --- Validation Functions ---
function getValidVoucherCode(voucherCode: Readonly<string>): string {
	const parts = voucherCode.split('?v=')
	const codeToTest = parts[1] || parts[0]

	const match = codeToTest.match(/[0-9A-Za-z]+/)
	return match ? match[0] : ''
}

const thaiPhoneNumberRegex = /^0[689]\d{8}$/
function isValidThaiPhoneNumber(phoneNumber: Readonly<string>): boolean {
	const cleanedNumber = phoneNumber.replace(/[^\d]/g, '')

	// Check if the number starts with '66' (thai code)
	if (cleanedNumber.startsWith('66') && cleanedNumber.length === 11) {
		return thaiPhoneNumberRegex.test('0' + cleanedNumber.substring(2))
	}

	return thaiPhoneNumberRegex.test(cleanedNumber)
}

// --- Custom Error Classes ---
class ValidationError extends Error {
	code: string
	constructor(code: Readonly<string>, message: Readonly<string>) {
		super(message)
		this.code = code
		this.name = 'ValidationError'
	}
}

class NetworkError extends Error {
	code: string
	constructor(code: Readonly<string>, message: Readonly<string>) {
		super(message)
		this.code = code
		this.name = 'NetworkError'
	}
}

class ApiError extends Error {
	code: string
	constructor(code: Readonly<string>, message: Readonly<string>) {
		super(message)
		this.code = code
		this.name = 'ApiError'
	}
}
class JsonParseError extends Error {
	code: string
	constructor(message: Readonly<string>, originalError: any) {
		super(message)
		this.code = INVALID_JSON_RESPONSE
		this.name = 'JsonParseError'
		this.cause = originalError
	}
}

// --- API Request Function ---
async function makeApiRequest(
	url: Readonly<string>,
	body: Readonly<{
		mobile: string
		voucher_hash: string
	}>
): Promise<Response> {
	const guard = TypeCompiler.Compile(shape)
	const encode = createAccelerator(shape)
	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/json'
		},
		body: guard.Check(body) ? encode(body) : JSON.stringify(body)
	})
	return response
}

// --- Response Parse Function ---
async function parseApiResponse(
	response: Readonly<Response>
): Promise<ApiResponse> {
	if (!response?.ok) {
		try {
			const errorData = await response?.json()
			if (errorData && errorData.status && errorData.status.code) {
				return errorData as ApiResponseError
			}
		} catch (parseError) {}
		throw new ApiError(
			`${HTTP_ERROR_PREFIX}${response?.ok ? 'OK' : 'UNKNOWN'}`,
			`API request failed: ${response?.statusText || 'Unknown'}`
		)
	}

	try {
		const data: any = await response?.json()
		if (data?.status?.code === 'SUCCESS' && data?.status?.data)
			return data as ApiResponseSuccess
		else return data as ApiResponseError
	} catch (jsonError) {
		throw new JsonParseError('API returned invalid JSON', jsonError)
	}
}

// --- Cache Setup ---
const cache = new Map<
	string,
	{ readonly data: ApiResponse; readonly expiry: number }
>()
const SUCCESS_CACHE_TTL = 1000 * 60 * 60 * 24 // 24 hours (adjust as needed)
const ERROR_CACHE_TTL = 1000 * 60 * 5 // 5 minutes for error responses

// --- Main redeemVoucher Function ---
async function redeemVoucher({
	phoneNumber,
	voucherCode
}: Readonly<RedeemVoucher>): Promise<ApiResponse> {
	const cleanedPhoneNumber = phoneNumber?.trim() || ''
	const validVoucherCode = voucherCode ? getValidVoucherCode(voucherCode) : ''

	if (!isValidThaiPhoneNumber(cleanedPhoneNumber))
		return {
			status: {
				code: INVALID_PHONE_NUMBER,
				message: 'Invalid Thai Phone Number.'
			},
			data: null
		}

	if (!validVoucherCode)
		return {
			status: {
				code: INVALID_VOUCHER_CODE,
				message: 'Invalid Voucher Code.'
			},
			data: null
		}

	const cacheKey = `${cleanedPhoneNumber}:${validVoucherCode}`
	const cachedResponse = cache.get(cacheKey)

	if (cachedResponse && cachedResponse.expiry > Date.now()) {
		return cachedResponse.data // Return cached data
	}

	const url = `https://gift.truemoney.com/campaign/vouchers/${validVoucherCode}/redeem`
	const body = {
		mobile: cleanedPhoneNumber,
		voucher_hash: validVoucherCode
	} satisfies typeof shape.static

	try {
		const response = await makeApiRequest(url, body)
		const apiResponse = await parseApiResponse(response)

		const ttl =
			apiResponse.status.code === 'SUCCESS'
				? SUCCESS_CACHE_TTL
				: ERROR_CACHE_TTL
		cache.set(cacheKey, { data: apiResponse, expiry: Date.now() + ttl })
		return apiResponse
	} catch (error) {
		if (error instanceof ValidationError || error instanceof ApiError)
			return {
				status: { code: error.code, message: error.message },
				data: null
			}

		if (error instanceof NetworkError || error instanceof JsonParseError)
			return {
				status: {
					code: error.code,
					message: error.message,
					error: error.cause
				},
				data: null
			}

		// Handle unexpected errors
		// should not happen, but for safety
		console.error('Unexpected error in redeemVoucher:', error)
		throw new NetworkError(
			NETWORK_ERROR,
			error instanceof Error ? error.message : 'Unexpected error'
		)
	}
}

export const TWAngpao = (name: string = 'TWA') => {
	return new Elysia().decorate(name, {
		async redeem(phoneNumber: string, voucherCode: string) {
			return redeemVoucher({
				phoneNumber,
				voucherCode
			})
		}
	})
}

export default TWAngpao
