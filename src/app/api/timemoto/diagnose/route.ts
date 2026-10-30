import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const results: Record<string, unknown> = {}

  // 1. Check env vars are present
  results.env = {
    supabaseUrl:        !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey:     !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    serviceRoleKeyLen:  process.env.SUPABASE_SERVICE_ROLE_KEY?.length ?? 0,
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // 2. Check column types using information_schema via alternate schema client
  const supabaseIS = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { db: { schema: 'information_schema' } }
  )
  const { data: cols, error: colErr } = await supabaseIS
    .from('columns')
    .select('column_name, data_type, is_nullable')
    .eq('table_name', 'attendance_events')
    .eq('table_schema', 'public')
    .order('ordinal_position' as never)

  results.tableColumns = colErr
    ? { error: colErr.message }
    : (cols ?? [])

  // 3. Try a minimal test upsert with a dummy row
  const testId = 'diagnose_test_' + Date.now()
  const { error: upsertErr } = await supabase
    .from('attendance_events')
    .upsert({
      timemoto_event_id: testId,
      user_full_name:    'Diagnose Test',
      clocking_type:     'In',
      time_logged:       new Date().toISOString(),
      time_inserted:     new Date().toISOString(),
    }, { onConflict: 'timemoto_event_id' })

  results.testUpsert = upsertErr
    ? { error: upsertErr.message, code: upsertErr.code, details: upsertErr.details, hint: upsertErr.hint }
    : 'success'

  if (!upsertErr) {
    await supabase.from('attendance_events').delete().eq('timemoto_event_id', testId)
  }

  // 4. Try upsert WITH raw_payload
  const testId2 = 'diagnose_test2_' + Date.now()
  const { error: upsertErr2 } = await supabase
    .from('attendance_events')
    .upsert({
      timemoto_event_id: testId2,
      user_full_name:    'Diagnose Test 2',
      clocking_type:     'In',
      time_logged:       new Date().toISOString(),
      time_inserted:     new Date().toISOString(),
      raw_payload:       { test: true },
    }, { onConflict: 'timemoto_event_id' })

  results.testUpsertWithRawPayload = upsertErr2
    ? { error: upsertErr2.message, code: upsertErr2.code, details: upsertErr2.details, hint: upsertErr2.hint }
    : 'success'

  if (!upsertErr2) {
    await supabase.from('attendance_events').delete().eq('timemoto_event_id', testId2)
  }

  // 5. Simulate a real TimeMoto payload — mirrors the exact structure TimeMoto sends
  const fakePayload = {
    id: 'diagnose_full_' + Date.now(),
    event: 'attendance.inserted',
    sequence: 5,
    dispatchedAt: 1779353967, // real TimeMoto format: unix timestamp number
    data: {
      userId:              '0b71f96b-132d-4304-92ce-6b1f3b452c43',
      userFullName:        'Diagnose Full Test',
      userFirstName:       'Diagnose',
      userLastName:        'Full Test',
      userEmployeeNumber:  '183',
      clockingType:        'Out',
      timeLogged:          '2026-05-21T10:48:12',  // no Z, like real events
      timeInserted:        '2026-05-21T08:48:06Z',
      clockingPairId:      '145518550',             // real string number like TimeMoto sends
      departmentName:      'Dentalassistentinnen',
      locationName:        'Belpstrasse',
      departmentId:        '4274cfb4-0b38-4ed1-bf05-513058d055c4',
      locationId:          '0be70e82-d953-4fe3-a2b8-6c30fc1aae09',
      recordHash:          -3843792886739339725,
      recordIgnored:       false,
      timeZone:            'Europe/Paris',
    },
  }

  const timemotoEventId = fakePayload.id
  const data2           = fakePayload.data
  const { error: fullErr } = await supabase
    .from('attendance_events')
    .upsert({
      timemoto_event_id: timemotoEventId,
      timemoto_user_id:  data2.userId,
      employee_id:       null,
      user_full_name:    data2.userFullName,
      clocking_type:     data2.clockingType,
      time_logged:       new Date(data2.timeLogged).toISOString(),
      time_inserted:     new Date(data2.timeInserted).toISOString(),
      clocking_pair_id:  data2.clockingPairId,
      department_name:   data2.departmentName,
      location_name:     data2.locationName,
      raw_payload:       fakePayload,
      deleted_at:        null,
    }, { onConflict: 'timemoto_event_id' })

  results.testFullWebhookSimulation = fullErr
    ? { error: fullErr.message, code: fullErr.code, details: fullErr.details, hint: fullErr.hint }
    : 'success — full webhook path works, POST handler is healthy'

  if (!fullErr) {
    await supabase.from('attendance_events').delete().eq('timemoto_event_id', timemotoEventId)
  }

  // 6. Check actual row count
  const { count, error: countErr } = await supabase
    .from('attendance_events')
    .select('*', { count: 'exact', head: true })
  results.rowCount = countErr ? { error: countErr.message } : count

  // 7. Show the 3 most recent rows
  const { data: recent, error: recentErr } = await supabase
    .from('attendance_events')
    .select('timemoto_event_id, user_full_name, clocking_type, time_logged, created_at')
    .order('created_at', { ascending: false })
    .limit(3)
  results.recentRows = recentErr ? { error: recentErr.message } : (recent ?? [])

  return NextResponse.json(results, { status: 200 })
}
