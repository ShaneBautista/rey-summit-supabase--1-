// @ts-nocheck
// Edge Function: admin-staff
// Creating / deleting staff logins needs the service-role key (Auth admin API),
// so it can't run in the browser. Everything else about staff (list, activate/deactivate)
// is handled by SQL functions.
//
// Deploy:  supabase functions deploy admin-staff
// Body:    { action: 'create', full_name, email, role, branch, password, selected_branch }
//          { action: 'delete', staff_id, selected_branch }
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const BRANCHES = ['Alangilan', 'Sta Teresita', 'Mabini Lipa', 'San Luis'];
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify({ ...body, status }), {
    status: 200, // keep HTTP 200 so supabase-js returns the body; real code is in `status`
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
const fail = (message: string, status = 400) => reply({ success: false, message }, status);
const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  // ---- who is calling? must be an admin ----
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: userData } = await admin.auth.getUser(token);
  const callerId = userData?.user?.id;
  if (!callerId) return fail('Admin login required.', 401);
  const { data: isAdmin } = await admin.from('admins').select('admin_id').eq('user_id', callerId).maybeSingle();
  if (!isAdmin) return fail('Admin login required.', 401);

  let p: any;
  try { p = await req.json(); } catch { return fail('Invalid staff account data.'); }
  const selected = BRANCHES.includes(p.selected_branch) ? p.selected_branch : 'all';

  // ---------------- create ----------------
  if (p.action === 'create') {
    const { full_name, email, role, branch, password } = p;
    if ([full_name, email, role, branch, password].some((v) => typeof v !== 'string')) {
      return fail('Enter valid text values for every staff account field.');
    }
    const fullName = full_name.trim();
    const mail = email.trim();
    const normName = squash(fullName);
    const normMail = squash(mail);
    if (!fullName || fullName.length > 100 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normMail)
        || normMail.length > 190 || !['sales', 'delivery'].includes(role)
        || !BRANCHES.includes(branch) || (selected !== 'all' && branch !== selected)
        || password.length < 8) {
      return fail('Enter a name, valid email, staff role, and password of at least 8 characters.');
    }

    const { data: dup } = await admin.from('staff_accounts')
      .select('full_name, normalized_name')
      .or(`normalized_name.eq.${normName},normalized_email.eq.${normMail}`).limit(1);
    if (dup && dup.length) {
      const field = dup[0].normalized_name === normName ? 'name' : 'email';
      return fail(`A staff account already uses that ${field}.`, 409);
    }

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: normMail, password, email_confirm: true, user_metadata: { account_type: 'staff' },
    });
    if (createErr || !created.user) {
      const taken = /already|registered|exists/i.test(createErr?.message ?? '');
      return fail(taken ? 'A staff account already uses that email.' : 'Could not create staff account.', taken ? 409 : 500);
    }

    const { error: insErr } = await admin.from('staff_accounts').insert({
      user_id: created.user.id, full_name: fullName, normalized_name: normName,
      email: mail, normalized_email: normMail, role, branch,
    });
    if (insErr) {
      await admin.auth.admin.deleteUser(created.user.id); // roll back the login
      return fail('Could not create staff account.', 500);
    }
    return reply({ success: true, message: 'Staff account created.' });
  }

  // ---------------- delete ----------------
  if (p.action === 'delete') {
    const staffId = Number(p.staff_id);
    if (!Number.isInteger(staffId) || staffId < 1) return fail('Select a valid staff account.');
    let q = admin.from('staff_accounts').select('user_id').eq('staff_id', staffId);
    if (selected !== 'all') q = q.eq('branch', selected);
    const { data: row } = await q.maybeSingle();
    if (!row) return fail('Staff account not found.', 404);
    const { error } = await admin.auth.admin.deleteUser(row.user_id); // cascades to staff_accounts
    if (error) return fail('Could not update staff accounts.', 500);
    return reply({ success: true, message: 'Staff account deleted.' });
  }

  return fail('Invalid staff account action.');
});
