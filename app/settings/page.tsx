'use client'

import { useRef, useState } from 'react'
import { Upload, RotateCcw, Check } from 'lucide-react'
import { DashboardHeader } from '@/components/DashboardHeader'
import { useClientBrand } from '@/lib/hooks/useClientBrand'
import { cn } from '@/lib/utils'
import { DEFAULT_BRANDING_SETTINGS, type BrandingSettings } from '@/lib/branding'

export default function SettingsPage() {
  const brand = useClientBrand()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (brand.isLoading) {
    return (
      <div className="min-h-screen">
        <DashboardHeader title="Settings" subtitle="Customize your dashboard branding" />
        <div className="p-6 text-center text-muted-foreground">Loading...</div>
      </div>
    )
  }

  const currentSettings: BrandingSettings = {
    logo_url: brand.logo,
    primary_color: brand.primaryColor,
    secondary_color: brand.secondaryColor,
    accent_color: brand.accentColor,
  }

  const persist = async (payload: BrandingSettings) => {
    setSaving(true)
    try {
      await brand.saveBranding(payload)
    } finally {
      setSaving(false)
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = async (event) => {
        const result = event.target?.result
        if (typeof result === 'string') {
          await persist({ ...currentSettings, logo_url: result })
        }
      }
      reader.readAsDataURL(file)
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const copyToClipboard = (color: string, key: string) => {
    navigator.clipboard.writeText(color)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }

  return (
    <div className="min-h-screen">
      <DashboardHeader title="Settings" subtitle="Customize your dashboard branding" />

      <div className="p-6 max-w-2xl">
        <div className="space-y-8">
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold mb-4">Logo</h2>
            <div className="flex items-center gap-6 flex-wrap">
              <div className="flex-shrink-0 w-24 h-24 rounded-lg border border-border bg-muted flex items-center justify-center">
                {brand.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logo} alt="Logo" className="w-full h-full object-cover rounded" />
                ) : (
                  <span className="text-xs text-muted-foreground text-center px-2">No logo</span>
                )}
              </div>

              <div className="flex-1 min-w-[200px]">
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={saving}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 disabled:opacity-60"
                >
                  <Upload className="w-4 h-4" />
                  Upload Logo
                </button>
                <p className="text-xs text-muted-foreground mt-2">PNG, JPG, or WebP</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold mb-6">Colors</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {[
                { field: 'primary_color', key: 'primaryColor', label: 'Primary', desc: 'Buttons, badges' },
                { field: 'secondary_color', key: 'secondaryColor', label: 'Secondary', desc: 'Charts, supporting UI' },
                { field: 'accent_color', key: 'accentColor', label: 'Accent', desc: 'Highlights and emphasis' },
              ].map(({ field, key, label, desc }) => {
                const value = brand[key as keyof typeof brand] as string
                return (
                  <div key={field} className="space-y-2">
                    <label className="text-sm font-semibold">{label}</label>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={value}
                        disabled={saving}
                        onChange={(e) => void persist({ ...currentSettings, [field]: e.target.value })}
                        className="w-12 h-10 rounded cursor-pointer border border-border"
                      />
                      <input
                        type="text"
                        value={value}
                        disabled={saving}
                        onChange={(e) => {
                          if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
                            void persist({ ...currentSettings, [field]: e.target.value.toUpperCase() })
                          }
                        }}
                        placeholder="#000000"
                        className="flex-1 px-3 py-2 text-xs rounded-lg border border-border bg-muted font-mono focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                      <button
                        onClick={() => copyToClipboard(value, key)}
                        className={cn('px-2 py-1 text-xs rounded transition-colors', copied === key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70')}
                      >
                        {copied === key ? <Check className="w-3 h-3" /> : 'Copy'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold mb-4">Live Preview</h2>
            <div className="space-y-4">
              <button style={{ background: brand.primaryColor }} className="w-full py-2 rounded-lg text-white font-semibold hover:opacity-90">
                Button
              </button>
              <div className="rounded-lg border border-border p-4" style={{ borderTopColor: brand.primaryColor, borderTopWidth: 3 }}>
                <p className="text-xs font-medium text-muted-foreground">Sample KPI</p>
                <p className="text-2xl font-bold mt-2" style={{ color: brand.primaryColor }}>
                  1,234
                </p>
              </div>
              <div className="flex gap-4">
                <div className="flex-1 h-20 rounded-lg" style={{ background: brand.chartColor1 }} />
                <div className="flex-1 h-20 rounded-lg" style={{ background: brand.chartColor2 }} />
              </div>
            </div>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => void persist(DEFAULT_BRANDING_SETTINGS)}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-muted hover:bg-muted/70 text-sm font-semibold disabled:opacity-60"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
