import { authQuery } from "./db-auth"

export interface TenantIntegration {
  second_brain_admin_email: string | null
  second_brain_api_token: string | null
}

export async function getTenantIntegration(customerId: number): Promise<TenantIntegration | null> {
  const rows = await authQuery<TenantIntegration>(
    `SELECT second_brain_admin_email, second_brain_api_token
       FROM tenant_integrations
      WHERE customer_id = $1
      LIMIT 1`,
    [customerId]
  )

  return rows[0] ?? null
}
