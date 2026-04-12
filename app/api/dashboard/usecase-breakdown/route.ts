import { NextRequest, NextResponse } from 'next/server'
import { getUsecaseBreakdown } from '@/lib/data-provider'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const from = new Date(searchParams.get('from') ?? '')
    const to   = new Date(searchParams.get('to')   ?? '')
    const idsParam = searchParams.get('usecaseIds')
    const usecaseIds = idsParam
      ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
      : undefined

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }

    const data = await getUsecaseBreakdown({ from, to, usecaseIds })
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[/api/dashboard/usecase-breakdown]', err)
    return NextResponse.json(
      { error: 'Failed to load usecase breakdown' },
      { status: 500 }
    )
  }
}
