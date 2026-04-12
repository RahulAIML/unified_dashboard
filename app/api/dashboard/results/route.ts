import { NextRequest, NextResponse } from 'next/server'
import { getEvaluationResults } from '@/lib/data-provider'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const from  = new Date(searchParams.get('from')  ?? '')
    const to    = new Date(searchParams.get('to')    ?? '')
    const limit = Number(searchParams.get('limit')   ?? 50)
    const idsParam = searchParams.get('usecaseIds')
    const usecaseIds = idsParam
      ? idsParam.split(',').map(Number).filter(n => !isNaN(n))
      : undefined

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return NextResponse.json({ error: 'Invalid date range' }, { status: 400 })
    }

    const data = await getEvaluationResults({ from, to, usecaseIds }, limit)
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[/api/dashboard/results]', err)
    return NextResponse.json(
      { error: 'Failed to load evaluation results' },
      { status: 500 }
    )
  }
}
