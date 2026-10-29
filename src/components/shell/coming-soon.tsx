import { Card } from "@/components/ui/primitives";

export function ComingSoon({ title, phase, items }: { title: string; phase: string; items: string[] }) {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-white">{title}</h1>
      <Card>
        <div className="text-xs font-bold uppercase text-brand-300">{phase}</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-300">
          {items.map((i) => <li key={i}>{i}</li>)}
        </ul>
        <p className="mt-3 text-xs text-slate-500">Enquanto isso: Ctrl+K busca qualquer restaurante e abre a Gaveta 360º.</p>
      </Card>
    </div>
  );
}
