import { FIELD, cleanText, enrichData, importCasesFromRows, normalizeYuc } from "../lib/domain.mjs";
import { CASE_IMPORT_UPDATE_FIELDS, caseImportChanges, parseCaseWorkbook } from "../lib/xlsx-case-import.mjs";

export function createCaseImportRoutes({
  readBody,
  readBinaryBody,
  readData,
  readDirectories,
  createTableRows,
  patchTableRows,
  cacheVersions,
  sendJson,
  requireManageYuc,
  requireEmployeeInYuc,
  findCase,
}) {
  return async function handleCaseImportRoute(req, res, url, user) {
    if (req.method === "POST" && url.pathname === "/api/cases/import-preview") {
      const requestedYuc = cleanText(url.searchParams.get("yuc"));
      if (!requestedYuc) {
        sendJson(res, 400, { ok: false, error: "Перед загрузкой выберите юридический центр." });
        return true;
      }
      const importYuc = normalizeYuc(requestedYuc);
      requireManageYuc(user, importYuc);
      const buffer = await readBinaryBody(req);
      const data = await readData(["cases", "employees"]);
      const directories = await readDirectories(data);
      const plan = parseCaseWorkbook(buffer, data.cases ?? [], {
        yuc: importYuc,
        employees: data.employees ?? [],
        directories,
      });
      plan.cacheVersions = cacheVersions(["cases", "employees"]);
      sendJson(res, 200, { ok: true, plan });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/cases/import-apply") {
      const body = await readBody(req);
      const rows = body.plan?.toAdd ?? body.rows ?? [];
      const updates = body.updates ?? [];
      if (!rows.length && !updates.length) {
        sendJson(res, 400, { ok: false, error: "Выберите новые дела или обновления для применения." });
        return true;
      }
      const data = await readData(["cases", "employees"]);
      const previewVersions = body.cacheVersions ?? {};
      const currentVersions = cacheVersions(["cases", "employees"]);
      const previewSnapshotCurrent = ["cases", "employees"].every((key) => (
        Number(previewVersions[key] || 0) === Number(currentVersions[key] || 0)
      ));
      for (const row of rows) {
        const yuc = row?.source?.[FIELD.yuc] ?? row[FIELD.yuc];
        requireManageYuc(user, yuc);
        const responsible = cleanText(row?.source?.[FIELD.responsible] ?? row[FIELD.responsible]);
        if (!responsible) {
          sendJson(res, 400, { ok: false, error: `Для строки ${row?.rowNumber ?? ""} не выбран ответственный.` });
          return true;
        }
        requireEmployeeInYuc(data, responsible, yuc, `Ответственный в строке ${row?.rowNumber ?? ""}`);
      }

      const updated = [];
      const rowsToPatch = [];
      for (const item of updates) {
        const source = item?.source ?? item;
        const caseId = cleanText(item?.caseId);
        const current = findCase(data, caseId);
        if (!caseId || !current) {
          sendJson(res, 400, { ok: false, error: `Дело для обновления не найдено: ${caseId || "без ID"}.` });
          return true;
        }
        requireManageYuc(user, current[FIELD.yuc]);
        const changes = caseImportChanges(current, source);
        if (!changes.length) continue;
        for (const field of CASE_IMPORT_UPDATE_FIELDS) {
          const change = changes.find((itemChange) => itemChange.field === field);
          if (change) current[field] = source[field];
        }
        updated.push({ caseId, changes });
        rowsToPatch.push({ row: current, changedFields: changes.map((change) => change.field) });
      }

      const result = importCasesFromRows(data, rows);
      const movementExpected = [
        ...result.added
          .filter((item) => cleanText(item[FIELD.caseMovement]))
          .map((item) => ({ caseId: item.case_id, movement: item[FIELD.caseMovement] })),
        ...updated
          .filter((item) => item.changes.some((change) => change.field === FIELD.caseMovement))
          .map((item) => ({
            caseId: item.caseId,
            movement: item.changes.find((change) => change.field === FIELD.caseMovement)?.next,
          })),
      ];
      if (rowsToPatch.length) await patchTableRows("cases", rowsToPatch);
      if (result.added.length) await createTableRows("cases", result.added);

      const importConfirmed = (freshData) => (
        result.added.every((item) => Boolean(findCase(freshData, item.case_id))) &&
        movementExpected.every((item) => {
          const saved = findCase(freshData, item.caseId);
          return saved && !caseImportChanges(saved, { [FIELD.caseMovement]: item.movement }).length;
        })
      );
      let confirmedData = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
        const freshCases = await readData(["cases"], { force: true });
        confirmedData = enrichData({ ...data, ...freshCases });
        if (importConfirmed(confirmedData)) break;
      }
      const missingMovement = movementExpected.filter((item) => (
        caseImportChanges(findCase(confirmedData, item.caseId) ?? {}, { [FIELD.caseMovement]: item.movement }).length
      ));
      const missingAdded = result.added.filter((item) => !findCase(confirmedData, item.case_id));
      if (missingAdded.length) {
        throw new Error(`MTS Tabs не подтвердил создание ${missingAdded.length} дел. Проверьте таблицу и повторите импорт.`);
      }
      if (missingMovement.length) {
        throw new Error(`MTS Tabs не подтвердил сохранение поля «Движение дела» для ${missingMovement.length} дел. Изменения не считаются завершёнными; проверьте настройки поля и повторите импорт.`);
      }
      sendJson(res, 200, {
        ok: true,
        result: {
          added: result.added.length,
          updated: updated.length,
          skipped: result.skipped.length,
          movementConfirmed: movementExpected.length,
          firstCaseId: result.added[0]?.case_id ?? "",
          lastCaseId: result.added.at(-1)?.case_id ?? "",
          previewSnapshotCurrent,
        },
        cases: [...result.added.map((item) => item.case_id), ...updated.map((item) => item.caseId)]
          .map((caseId) => findCase(confirmedData, caseId))
          .filter(Boolean),
        employees: confirmedData.employees ?? [],
      });
      return true;
    }

    return false;
  };
}
