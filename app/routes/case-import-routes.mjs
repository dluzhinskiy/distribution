import { FIELD, cleanText, importCasesFromRows, normalizeYuc } from "../lib/domain.mjs";
import { CASE_IMPORT_UPDATE_FIELDS, caseImportChanges, parseCaseWorkbook } from "../lib/xlsx-case-import.mjs";

export function createCaseImportRoutes({
  readBody,
  readBinaryBody,
  readData,
  readDirectories,
  saveAndConfirm,
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
      const data = await readData();
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
      const confirmedData = await saveAndConfirm(data, ["cases"], (freshData) => (
        result.added.every((item) => Boolean(findCase(freshData, item.case_id))) &&
        movementExpected.every((item) => cleanText(findCase(freshData, item.caseId)?.[FIELD.caseMovement]) === cleanText(item.movement))
      ));
      const missingMovement = movementExpected.filter((item) => (
        cleanText(findCase(confirmedData, item.caseId)?.[FIELD.caseMovement]) !== cleanText(item.movement)
      ));
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
        },
        data: confirmedData,
      });
      return true;
    }

    return false;
  };
}
