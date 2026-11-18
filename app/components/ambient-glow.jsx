/** Soft brand-coloured light behind the glass surfaces. */
export function AmbientGlow() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute -right-40 -top-48 size-[680px] rounded-full bg-ember-500/[0.13] blur-[130px]" />
      <div className="absolute -bottom-56 left-[8%] size-[620px] rounded-full bg-[#e7cdb6]/80 blur-[130px]" />
      <div className="absolute left-[45%] top-[30%] size-[460px] rounded-full bg-cocoa-3/[0.07] blur-[110px]" />
    </div>
  );
}
