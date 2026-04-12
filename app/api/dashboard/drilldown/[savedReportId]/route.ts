import { NextRequest, NextResponse } from 'next/server'
import { getDrilldown } from '@/lib/data-provider'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ savedReportId: string }> }
) {
  try {
    const { savedReportId } = await params
    const id = Number(savedReportId)

    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid report ID' }, { status: 400 })
    }

    const data = await getDrilldown(id)

    if (!data) {
      return NextResponse.json(
        { error: 'Report not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(data)
  } catch (err) {
    console.error('[/api/dashboard/drilldown]', err)
    return NextResponse.json(
      { error: 'Failed to load drilldown data' },
      { status: 500 }
    )
  }
}
