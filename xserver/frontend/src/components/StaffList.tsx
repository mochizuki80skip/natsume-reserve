import { useState } from 'react';
import { Link } from 'react-router-dom';

interface Member { id: string; name: string; role: string; active: boolean; startDate?: string | null; endDate?: string | null; joinType?: string | null }

export default function StaffList({ members, maxTherapists, maxReception, onRefresh }: { members: Member[]; maxTherapists: number; maxReception: number; onRefresh: () => void }) {
  const [name, setName] = useState('');
  const [role, setRole] = useState<'THERAPIST' | 'RECEPTION'>('THERAPIST');
  const [joinType, setJoinType] = useState('');
  const [startDate, setStartDate] = useState('');
  const [msg, setMsg] = useState('');

  async function call(method: string, body: object) {
    const r = await fetch('/api/admin/staff-members', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? '' : j.error ?? '失敗しました');
    if (r.ok) onRefresh();
    return r.ok;
  }
  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (await call('POST', { name, role, joinType, startDate })) { setName(''); setJoinType(''); setStartDate(''); }
  }

  const th = members.filter((m) => m.role === 'THERAPIST');
  const rc = members.filter((m) => m.role === 'RECEPTION');
  const Row = ({ m }: { m: Member }) => (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-t py-1.5 ${m.active ? '' : 'text-slate-400'}`}>
      <input defaultValue={m.name} onBlur={(e) => e.target.value.trim() && e.target.value !== m.name && call('PUT', { id: m.id, name: e.target.value.trim() })} className="w-32 rounded border px-2 py-1" aria-label="氏名" />
      <span className="whitespace-nowrap">
        <button type="button" onClick={() => call('PUT', { id: m.id, move: 'up' })} className="rounded border px-2 py-1" title="上へ">↑</button>
        <button type="button" onClick={() => call('PUT', { id: m.id, move: 'down' })} className="ml-1 rounded border px-2 py-1" title="下へ">↓</button>
      </span>
      <select value={m.joinType ?? ''} onChange={(e) => call('PUT', { id: m.id, joinType: e.target.value })} className="rounded border px-1 py-1 text-xs" title="新入社員・異動（開始日から1か月、シフト表に印を出します）" aria-label={`${m.name} 区分`}>
        <option value="">区分なし</option>
        <option value="NEW">新入社員</option>
        <option value="TRANSFER">異動</option>
      </select>
      <button type="button" onClick={() => call('PUT', { id: m.id, active: !m.active })} className="rounded border px-2 py-1 text-xs">{m.active ? '休職・停止' : '復帰'}</button>
      <button type="button" onClick={() => confirm(`${m.name} を削除しますか？シフトも消えます。`) && call('DELETE', { id: m.id })} className="rounded border border-red-300 px-2 py-1 text-xs text-red-700">削除</button>
      <span className="flex basis-full flex-wrap items-center gap-1 pl-1 text-xs text-slate-600">
        所属期間
        <input type="date" defaultValue={m.startDate ?? ''} onBlur={(e) => e.target.value !== (m.startDate ?? '') && call('PUT', { id: m.id, startDate: e.target.value })} className="rounded border px-1 py-0.5" aria-label={`${m.name} 所属開始日`} />
        〜
        <input type="date" defaultValue={m.endDate ?? ''} onBlur={(e) => e.target.value !== (m.endDate ?? '') && call('PUT', { id: m.id, endDate: e.target.value })} className="rounded border px-1 py-0.5" aria-label={`${m.name} 所属終了日`} />
        <span className="text-slate-400">（空欄＝制限なし）</span>
      </span>
    </div>
  );
  const List = ({ list, label, max }: { list: Member[]; label: string; max: number }) => (
    <div>
      <div className="mb-1 text-xs text-slate-500">{label}（{list.filter((m) => m.active).length}／最大 {max} 名）</div>
      {list.length === 0 ? <p className="text-xs text-slate-400">未登録{label === '施術者' ? '（既定の施術者数を使用中）' : ''}</p> : (
        <div>{list.map((m) => <Row key={`${m.id}:${m.startDate}:${m.endDate}`} m={m} />)}</div>
      )}
    </div>
  );

  return (
    <section className="order-first rounded border bg-white p-4 text-sm xl:order-none">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="font-bold">スタッフ・シフト</h2>
        <Link to="/admin/shifts" className="rounded bg-brand px-3 py-1 text-white">月間シフト表を開く</Link>
        <span className="text-xs text-slate-500">シフト表の施術者の人数（午前／午後）が、顧客に見える枠数になります。</span>
      </div>
      {msg && <p className="mb-2 rounded bg-red-50 px-3 py-1 text-red-700">{msg}</p>}
      <div className="grid grid-cols-1 gap-y-4">
        <List list={th} label="施術者" max={maxTherapists} />
        <List list={rc} label="受付" max={maxReception} />
      </div>
      <form onSubmit={add} className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
        <select value={role} onChange={(e) => setRole(e.target.value as 'THERAPIST' | 'RECEPTION')} className="rounded border px-2 py-1">
          <option value="THERAPIST">施術者</option>
          <option value="RECEPTION">受付</option>
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="氏名" required className="w-40 rounded border px-2 py-1" />
        <select value={joinType} onChange={(e) => setJoinType(e.target.value)} className="rounded border px-2 py-1">
          <option value="">区分なし</option>
          <option value="NEW">新入社員</option>
          <option value="TRANSFER">異動</option>
        </select>
        <label className="flex items-center gap-1 text-xs text-slate-600">所属開始日
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded border px-2 py-1 text-sm" />
        </label>
        <button type="submit" className="rounded border px-3 py-1">追加</button>
      </form>
      <p className="mt-2 text-xs text-slate-500">
        新入社員は入社日を「所属開始日」にして登録します（前もって登録しても、開始日までは枠に数えません）。
        異動は、元の店舗で「終了日」（例：20日）を入れ、新しい店舗で「開始日」（例：21日）を入れて登録します。
        区分を選ぶと、開始日から1か月間シフト表に「新人」「異動」の印が出ます。
      </p>
    </section>
  );
}
