import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYBOOKS, missingDefaults, recommendScripts, systemGroup } from "./playbooks";

describe("playbooks padrão e script recomendado", () => {
  it("são 7, sem duplicar ao recarregar", () => {
    expect(DEFAULT_PLAYBOOKS).toHaveLength(7);
    expect(missingDefaults([])).toHaveLength(7);
    expect(missingDefaults([{ title: "conexão 90s" }, { title: "Pós-venda 7d" }])).toHaveLength(5);
  });
  it("classifica os sistemas da base real", () => {
    expect(systemGroup("Anota AI")).toBe("delivery");
    expect(systemGroup("MenuDino")).toBe("delivery");
    expect(systemGroup("OlaClick")).toBe("delivery");
    expect(systemGroup("InstaDelivery")).toBe("delivery");
    expect(systemGroup("F.Rest")).toBe("pdv");
    expect(systemGroup("Saipos")).toBe("pdv");
    expect(systemGroup(null)).toBe("manual");
    expect(systemGroup("PlaceWeb")).toBe("desconhecido");
  });
  it("recomenda pela etapa e pelo sistema, preferindo a versão salva", () => {
    const r = recommendScripts({ status: "lead_importado", current_system: "Anota AI", persona: "dono_operacional" }, []);
    expect(r.map((x) => x.key)).toEqual(["conexao_90s", "battle_delivery"]);
    const saved = [{ id: "p1", title: "Virada \"Como\"", content_md: "minha versão" }];
    const n = recommendScripts({ status: "negociacao", current_system: "Saipos", persona: "gerente_contratado" }, saved);
    expect(n[0]).toMatchObject({ key: "virada_como", playbookId: "p1", content_md: "minha versão" });
    expect(n[1].key).toBe("battle_pdv");
    const f = recommendScripts({ status: "proposta_enviada", current_system: null, persona: "socio_financeiro" }, []);
    expect(f.map((x) => x.key)).toEqual(["ancoragem_ifood"]);
  });
});
