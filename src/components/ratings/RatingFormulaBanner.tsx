/** Shadow Team Elo 계산식·불확실성 안내 (모델 1.0.0 파라미터 기준) */
export function RatingFormulaBanner() {
  return (
    <section className="rounded-2xl border border-emerald-100 bg-white p-4 text-sm text-gray-700">
      <h2 className="text-base font-extrabold text-green-900">글로벌 레이팅은 어떻게 계산되나요?</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-5">
        <li>
          각 선수는 초기값 <strong>1500</strong>에서 시작합니다.
        </li>
        <li>
          복식/단식 팀 레이팅은 참가 선수의 Elo <strong>산술평균</strong>입니다.
        </li>
        <li>
          승률 기대값{' '}
          <code className="rounded bg-gray-100 px-1 text-xs">
            E<sub>A</sub> = 1 / (1 + 10<sup>(R<sub>B</sub>−R<sub>A</sub>)/400</sup>)
          </code>
        </li>
        <li>
          변동량{' '}
          <code className="rounded bg-gray-100 px-1 text-xs">Δ = K × (S − E)</code>,{' '}
          <strong>K = 32</strong>. 승리 S=1, 패배 S=0, 무승부 S=0.5. 같은 팀 전원에게 동일 Δ가
          반영됩니다.
        </li>
      </ol>

      <h3 className="mt-4 font-extrabold text-green-900">불확실성(±) 의미</h3>
      <p className="mt-2 leading-relaxed">
        불확실성{' '}
        <code className="rounded bg-gray-100 px-1 text-xs">
          u = max(60, 350 / √(경기수+1))
        </code>
        . 값이 <strong>클수록</strong> 표본이 적어 신뢰도가 낮고, <strong>작을수록</strong> 결과에
        가까워집니다. 하한은 60입니다. 경기 수 10회 미만은 <strong>잠정(provisional)</strong>으로
        표시됩니다.
      </p>
      <p className="mt-2 text-xs text-gray-500">
        A–B, B–C 경기가 있으면 B를 통해 A와 C도 같은 글로벌 풀에서 간접 비교됩니다. 아래
        「플랫폼 전체 연결」과 「두 선수 연결 경로」에서 그 관계를 확인할 수 있습니다.
      </p>
    </section>
  )
}
