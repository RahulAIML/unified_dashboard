'use client'

import { useState, useRef } from 'react'
import { Upload, RotateCcw, Check } from 'lucide-react'
import { DashboardHeader } from '@/components/DashboardHeader'
import { useClientBrand } from '@/lib/hooks/useClientBrand'
import { useCustomBranding } from '@/lib/hooks/useCustomBranding'
import { cn } from '@/lib/utils'

export default function SettingsPage() {
  const defaultBrand = useClientBrand()
  const { brand, loaded, updateBrand, resetBrand, setLogoFromFile } = useCustomBranding()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = useState<string | null>(null)

  if (!loaded) {
    return (
      <div className="min-h-screen">
        <DashboardHeader title="Settings" subtitle="Customize your dashboard branding" />
        <div className="p-6 text-center text-muted-foreground">Loading...</div>
      </div>
    )
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      setLogoFromFile(file)
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
          {/* Logo Upload */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold mb-4">Logo</h2>
            <div className="flex items-center gap-6 flex-wrap">
              {/* Preview */}
              <div className="flex-shrink-0 w-24 h-24 rounded-lg border border-border bg-muted flex items-center justify-center">
                {brand.logo ? (
                  <img src={brand.logo} alt="Logo" className="w-full h-full object-cover rounded" />
                ) : (
                  <span className="text-xs text-muted-foreground text-center px-2">No logo</span>
                )}
              </div>

              {/* Upload */}
              <div className="flex-1 min-w-[200px]">
                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90"
                >
                  <Upload className="w-4 h-4" />
                  Upload Logo
                </button>
                <p className="text-xs text-muted-foreground mt-2">PNG, JPG, or WebP</p>
              </div>
            </div>
          </div>

          {/* Color Customization */}
          <div className="rounded-xl border border-border bg-card p-6">
            <h2 className="text-lg font-bold mb-6">Colors</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {[
                { key: 'primaryColor', label: 'Primary', desc: 'Buttons, badges' },
                { key: 'secondaryColor', label: 'Secondary', desc: 'Inactive states' },
                { key: 'accentColor', label: 'Accent', desc: 'Highlights' },
                { key: 'chartColor1', label: 'Chart 1', desc: 'Primary series' },
                { key: 'chartColor2', label: 'Chart 2', desc: 'Secondary series' },
              ].map(({ key, label, desc }) => {
                const colorKey = key as keyof typeof brand
                const value = brand[colorKey] as string
                return (
                  <div key={key} className="space-y-2">
                    <label className="text-sm font-semibold">{label}</label>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={value}
                        onChange={(e) => updateBrand({ [colorKey]: e.target.value })}
                        className="w-12 h-10 rounded cursor-pointer border border-border"
                      />
                      <input
                        type="text"
                        value={value}
                        onChange={(e) => {
                          if (/^#[0-9A-F]{6}$/i.test(e.target.value)) {
                            updateBrand({ [colorKey]: e.target.value })
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

          {/* Live Preview */}
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

          {/* Reset Button */}
          <div className="flex justify-end">
            <button
              onClick={() => {
                if (confirm('Reset to default branding?')) {
                  resetBrand()
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-border bg-muted hover:bg-muted/70 text-sm font-semibold"
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
