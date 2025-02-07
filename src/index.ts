// src/index.ts

import { Elysia } from 'elysia'
import { Type as t } from '@sinclair/typebox'
import { TypeCompiler } from '@sinclair/typebox/compiler'
import { createAccelerator } from 'json-accelerator'

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
	statusCode: number
	status: {
		code: string
		message: string
		error?: any // Optional error details
	}
	data?: null // Explicitly allow null data
}

type ApiResponse = ApiResponseSuccess | ApiResponseError

function getValidVoucherCode(voucherCode: string): string {
	const parts = (voucherCode + '').split('v=')
	const codeToTest = parts[1] || parts[0]

	const match = codeToTest.match(/[0-9A-Za-z]+/)
	return match ? match[0] : ''
}

const thaiPhoneNumberRegex = /^(?:0)[689]\d{8}$/
function isValidThaiPhoneNumber(phoneNumber: string): boolean {
	return thaiPhoneNumberRegex.test(phoneNumber)
}

async function redeemVoucher({
	phoneNumber,
	voucherCode
}: RedeemVoucher): Promise<ApiResponse> {
	const cleanedPhoneNumber = phoneNumber.trim()
	if (!isValidThaiPhoneNumber(cleanedPhoneNumber))
		return {
			statusCode: 400,
			status: {
				code: 'INVALID_PHONE_NUMBER',
				message: 'Invalid Thai Phone Number.'
			},
			data: null
		}

	const validVoucherCode = getValidVoucherCode(voucherCode)
	if (!validVoucherCode)
		return {
			statusCode: 400,
			status: {
				code: 'INVALID_VOUCHER_CODE',
				message: 'Invalid Voucher Code.'
			},
			data: null
		}

	try {
		// Make API request to redeem voucher
		const url = `https://gift.truemoney.com/campaign/vouchers/${validVoucherCode}/redeem`

		const body = {
			mobile: cleanedPhoneNumber,
			voucher_hash: validVoucherCode
		} satisfies typeof shape.static

		const guard = TypeCompiler.Compile(shape)
		const encode = createAccelerator(shape)

		const response = await fetch(url, {
			method: 'POST',
			headers: {
				'content-type': 'application/json'
			},
			body: guard.Check(body) ? encode(body) : JSON.stringify(body)
		})

		if (!response.ok) {
			try {
				const errorData = await response.json()
				if (errorData && errorData.status && errorData.status.code)
					return errorData as ApiResponseError
			} catch (parseError) {
				return {
					statusCode: response.status,
					status: {
						code: `HTTP_ERROR_${response.status}`,
						message: `API request failed: ${response.statusText}`
					},
					data: null
				}
			}
			return {
				statusCode: response.status,
				status: {
					code: `HTTP_ERROR_${response.status}`,
					message: `API request failed: ${response.statusText}`
				},
				data: null
			}
		}

		try {
			const data: any = await response.json()

			// Type guard to check
			if (
				data &&
				data.status &&
				data.status.code === 'SUCCESS' &&
				data.status.data
			)
				return data as ApiResponseSuccess // Cast to the success type
			else return data as ApiResponseError // Cast to the error type
		} catch (jsonError) {
			return {
				statusCode: response.status,
				status: {
					code: 'INVALID_JSON_RESPONSE',
					message: 'API returned invalid JSON',
					error: jsonError
				},
				data: null
			}
		}
	} catch (err) {
		return {
			statusCode: 500,
			status: {
				code: 'NETWORK_ERROR',
				message: 'Network or API call failed',
				error: err
			},
			data: null
		}
	}
}

export const TWAngpao = <const Name extends string = 'TWA'>(
	name = 'TWA' as Name
) => {
	return new Elysia().decorate(name as Name extends string ? Name : 'TWA', {
		async redeem(phoneNumber: string, voucherCode: string) {
			return await redeemVoucher({
				phoneNumber,
				voucherCode
			} as RedeemVoucher)
		}
	})
}
export default TWAngpao
