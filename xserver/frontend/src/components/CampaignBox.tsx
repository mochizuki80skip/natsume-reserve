// 経路（ギフトカード・媒体・紹介元の QR）ごとのキャンペーンを、患者様の予約ページ・確認ページに出す（店舗向けメモは出さない）
export interface PublicCampaign { route: string; name: string; description: string; insurance: { label: string; amount: number }[]; kind?: string }

export default function CampaignBox({ c, compact = false }: { c: PublicCampaign; compact?: boolean }) {
  return (
    <div className={`rounded-[10px] border-2 border-orange-400 bg-orange-50 px-3 ${compact ? 'py-2' : 'py-2.5'} text-sm`} role="note" aria-label="キャンペーンの内容">
      {c.route && <span className="rounded bg-orange-600 px-1.5 text-[11px] font-bold text-white">{c.route}特典</span>}
      <b className="mt-0.5 block text-[15px] text-orange-900">{c.name}</b>
      {c.description && <p className="whitespace-pre-line text-[12.5px] leading-relaxed text-slate-800">{c.description}</p>}
      {c.insurance.length > 0 && (
        <>
          <p className="mt-1.5 text-[12px] font-bold text-orange-900">保険のご負担の目安</p>
          <table className="w-full rounded-md bg-white text-[13px]" aria-label="保険のご負担の目安">
            <tbody>{c.insurance.map((r) => <tr key={r.label} className="border-b border-dashed border-orange-200 last:border-0"><td className="px-2 py-1">{r.label}の方</td><td className="px-2 py-1 text-right font-bold tabular-nums">{r.amount.toLocaleString()}円</td></tr>)}</tbody>
          </table>
          <p className="mt-1 text-[11px] text-slate-600">金額は目安です（症状・施術の内容で変わることがあります）</p>
        </>
      )}
    </div>
  );
}
