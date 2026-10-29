import { ComingSoon } from "@/components/shell/coming-soon";
export default function Page() {
  return <ComingSoon title="Agenda & Rotas" phase="Fase 2" items={["Rota do dia (data, turno, modo, KM) com visitas ordenadas", "Otimizar rota por proximidade (vizinho mais próximo sobre lat/long das contas)", "KM e tempo total (deslocamento + duração das visitas)"]} />;
}
