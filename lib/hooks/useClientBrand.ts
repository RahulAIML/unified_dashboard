"use client"

import { useBrandContext } from "@/components/ClientBrandProvider"

export function useClientBrand() {
  return useBrandContext()
}
