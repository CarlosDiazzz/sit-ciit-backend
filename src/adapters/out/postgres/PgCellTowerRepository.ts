import type { Pool } from "pg";

import type { CellTower } from "../../../domain/ports/CellTowerPort.js";
import type { CellTowerRepository } from "../../../domain/ports/CellTowerRepository.js";

interface CellTowerRow {
  lat: string;
  lon: string;
  radio: string | null;
  range_m: string | null;
  mcc: number | null;
  mnc: number | null;
  samples: number | null;
}

function toTower(r: CellTowerRow): CellTower {
  return {
    lat: Number(r.lat),
    lon: Number(r.lon),
    radio: r.radio,
    rangeM: r.range_m === null ? null : Number(r.range_m),
    mcc: r.mcc,
    mnc: r.mnc,
    samples: r.samples,
  };
}

export class PgCellTowerRepository implements CellTowerRepository {
  constructor(private readonly pool: Pool) {}

  async replaceAll(towers: CellTower[]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Es una foto del área, no un historial: se reemplaza completa en
      // vez de upsert incremental (evita acumular torres que OpenCelliD
      // ya no reporta).
      await client.query("DELETE FROM cell_towers");
      for (const t of towers) {
        await client.query(
          `INSERT INTO cell_towers (lat, lon, radio, range_m, mcc, mnc, samples)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [t.lat, t.lon, t.radio, t.rangeM, t.mcc, t.mnc, t.samples]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async findAll(): Promise<CellTower[]> {
    const { rows } = await this.pool.query<CellTowerRow>(
      `SELECT lat, lon, radio, range_m, mcc, mnc, samples FROM cell_towers`
    );
    return rows.map(toTower);
  }

  async lastFetchedAt(): Promise<Date | null> {
    const { rows } = await this.pool.query<{ max: Date | null }>(
      `SELECT max(fetched_at) AS max FROM cell_towers`
    );
    return rows[0]?.max ?? null;
  }
}
