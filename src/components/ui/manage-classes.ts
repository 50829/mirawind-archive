export const manageButton =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2.5 font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60";

export const managePrimaryButton = `${manageButton} bg-emerald-800 text-white hover:bg-emerald-900`;

export const manageSecondaryButton = `${manageButton} bg-stone-700 text-white hover:bg-stone-800`;

export const manageQuietButton = `${manageButton} bg-stone-100 text-stone-700 hover:bg-stone-200 aria-pressed:bg-emerald-700 aria-pressed:text-white`;

export const manageField =
  "min-h-11 w-full rounded-md border border-stone-400 bg-white px-3 py-2 font-[inherit] text-stone-800";

export const manageFieldLabel = "my-4 grid gap-1.5";

export const managePanel = "rounded-lg border border-stone-300 bg-white p-6";

export const manageQuietText = "text-sm text-stone-600";

export const manageDialog =
  "m-auto max-h-[min(100%,50rem)] w-[min(100%,40rem)] border border-stone-300 bg-white p-0 text-stone-800 backdrop:bg-black/45 max-[850px]:m-0 max-[850px]:h-dvh max-[850px]:max-h-none max-[850px]:w-screen max-[850px]:max-w-none max-[850px]:border-0";

export const manageDialogHeader =
  "sticky top-0 z-10 flex min-h-14 items-center justify-between border-b border-stone-200 bg-white px-4 py-2 font-bold";

export const manageDialogClose = `${manageSecondaryButton} size-11 min-h-11 p-0`;
