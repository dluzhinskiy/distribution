import { FIELD, YUC_SETTING, cleanText, normalizeType, normalizeYuc, yesNo } from "../lib/domain.mjs";
import {
  assertRegionalAssignment,
  assertRegionalSubstitution,
  normalizeRegionalAssignment,
  normalizeRegionalSubstitution,
  regionalAssignmentKey,
  regionalSubstitutionKey,
} from "../lib/regional-rules.mjs";
import { validateLoadCoefficients } from "../lib/load-coefficients.mjs";

export function createSettingsRoutes({
  readBody,
  readData,
  saveAndConfirm,
  sendJson,
  requireManageYuc,
  requireEmployeeInYuc,
  requireAdmin = () => {},
}) {
  return async function handleSettingsRoute(req, res, url, user) {
    if (req.method === "PUT" && url.pathname === "/api/load-coefficients") {
      requireAdmin(user);
      const body = await readBody(req);
      const rows = validateLoadCoefficients(body.rows);
      const data = await readData();
      data.loadCoefficients = rows;
      const confirmedData = await saveAndConfirm(data, ["loadCoefficients"]);
      sendJson(res, 200, { ok: true, coefficients: confirmedData.loadCoefficients, data: confirmedData });
      return true;
    }

    if (req.method === "PATCH" && url.pathname.startsWith("/api/yuc-settings/")) {
      const yuc = normalizeYuc(decodeURIComponent(url.pathname.split("/").pop()));
      requireManageYuc(user, yuc);
      const patch = await readBody(req);
      const data = await readData();
      let row = data.yucSettings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc);
      if (!row) {
        row = {
          "Название": "",
          [FIELD.yuc]: yuc,
          [YUC_SETTING.regionalEnabled]: "Нет",
          [YUC_SETTING.overloadThreshold]: 5,
          [YUC_SETTING.overloadMode]: "общая нагрузка",
          [YUC_SETTING.allowOutsideRegion]: "Да",
          [YUC_SETTING.includeInactiveLoad]: "Нет",
          [YUC_SETTING.missingRegionMode]: "общая очередь",
          [YUC_SETTING.unavailableRegionalMode]: "заместитель затем общая очередь",
        };
        data.yucSettings.push(row);
      }
      Object.assign(row, {
        [YUC_SETTING.regionalEnabled]: yesNo(patch[YUC_SETTING.regionalEnabled]),
        [YUC_SETTING.overloadThreshold]: Number(patch[YUC_SETTING.overloadThreshold]) || 0,
        [YUC_SETTING.overloadMode]: cleanText(patch[YUC_SETTING.overloadMode]) || "общая нагрузка",
        [YUC_SETTING.allowOutsideRegion]: yesNo(patch[YUC_SETTING.allowOutsideRegion]),
        [YUC_SETTING.includeInactiveLoad]: yesNo(patch[YUC_SETTING.includeInactiveLoad]),
        [YUC_SETTING.missingRegionMode]: cleanText(patch[YUC_SETTING.missingRegionMode]) || "общая очередь",
        [YUC_SETTING.unavailableRegionalMode]: cleanText(patch[YUC_SETTING.unavailableRegionalMode]) || "заместитель затем общая очередь",
      });
      const confirmedData = await saveAndConfirm(data, ["yucSettings"], (freshData) => (
        Boolean(freshData.yucSettings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc))
      ));
      sendJson(res, 200, { ok: true, settings: confirmedData.yucSettings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc), data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/deadline-settings") {
      const body = await readBody(req);
      const yuc = normalizeYuc(body.yuc);
      requireManageYuc(user, yuc);
      const rows = Array.isArray(body.rows) ? body.rows : [];
      const data = await readData();
      for (const raw of rows) {
        const type = normalizeType(raw[FIELD.caseType]);
        if (!type) continue;
        const activityDays = Number(raw["Активность, дни"]);
        const autocompletionDays = Number(raw["Автозавершение, дни"]);
        const debtEnabledValue = yesNo(raw["Учитывать долг"]);
        const maxDebtValue = Math.max(0, Math.floor(Number(raw["Максимальный долг"]) || 0));
        if (!Number.isFinite(activityDays) || activityDays <= 0) {
          throw new Error(`Срок активности для «${type}» должен быть положительным числом.`);
        }
        if (!Number.isFinite(autocompletionDays) || autocompletionDays <= 0) {
          throw new Error(`Срок автозавершения для «${type}» должен быть положительным числом.`);
        }
        let row = data.settings.find((item) => normalizeYuc(item[FIELD.yuc]) === yuc && normalizeType(item[FIELD.caseType]) === type);
        const next = {
          [FIELD.yuc]: yuc,
          [FIELD.caseType]: type,
          "Активность, дни": activityDays,
          "Автозавершение, дни": autocompletionDays,
          "Учитывать долг": debtEnabledValue,
          "Максимальный долг": maxDebtValue,
        };
        if (!row) data.settings.push(next);
        else Object.assign(row, next);
      }
      const confirmedData = await saveAndConfirm(data, ["settings"]);
      sendJson(res, 200, { ok: true, data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/regional-assignments/upsert") {
      const body = await readBody(req);
      const data = await readData();
      const row = normalizeRegionalAssignment(body.row, body.yuc);
      requireManageYuc(user, row[FIELD.yuc]);
      const originalKey = body.original ? regionalAssignmentKey(normalizeRegionalAssignment(body.original, body.yuc)) : "";
      assertRegionalAssignment(row);
      requireEmployeeInYuc(data, row["Сотрудник"], row[FIELD.yuc], "Закрепляемый сотрудник");
      const nextKey = regionalAssignmentKey(row);
      const duplicate = data.regionalAssignments.find((item) => regionalAssignmentKey(item) === nextKey && regionalAssignmentKey(item) !== originalKey);
      if (duplicate) throw new Error("Такое региональное закрепление уже существует.");
      const index = data.regionalAssignments.findIndex((item) => regionalAssignmentKey(item) === (originalKey || nextKey));
      if (index >= 0) data.regionalAssignments[index] = { ...data.regionalAssignments[index], ...row };
      else data.regionalAssignments.push(row);
      const confirmedData = await saveAndConfirm(data, ["regionalAssignments"]);
      sendJson(res, 200, { ok: true, row, data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/regional-assignments/delete") {
      const body = await readBody(req);
      const scopedRow = normalizeRegionalAssignment(body.row, body.yuc);
      requireManageYuc(user, scopedRow[FIELD.yuc]);
      const key = regionalAssignmentKey(scopedRow);
      const data = await readData();
      data.regionalAssignments = data.regionalAssignments.filter((item) => regionalAssignmentKey(item) !== key);
      const confirmedData = await saveAndConfirm(data, ["regionalAssignments"]);
      sendJson(res, 200, { ok: true, data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/regional-substitutions/upsert") {
      const body = await readBody(req);
      const data = await readData();
      const row = normalizeRegionalSubstitution(body.row, body.yuc);
      requireManageYuc(user, row[FIELD.yuc]);
      assertRegionalSubstitution(row);
      requireEmployeeInYuc(data, row["Основной сотрудник"], row[FIELD.yuc], "Основной сотрудник");
      requireEmployeeInYuc(data, row["Замещающий сотрудник"], row[FIELD.yuc], "Замещающий сотрудник");
      const originalKey = body.original ? regionalSubstitutionKey(normalizeRegionalSubstitution(body.original, body.yuc)) : "";
      const nextKey = regionalSubstitutionKey(row);
      const duplicate = data.regionalSubstitutions.find((item) => regionalSubstitutionKey(item) === nextKey && regionalSubstitutionKey(item) !== originalKey);
      if (duplicate) throw new Error("Такое региональное замещение уже существует.");
      const index = data.regionalSubstitutions.findIndex((item) => regionalSubstitutionKey(item) === (originalKey || nextKey));
      if (index >= 0) data.regionalSubstitutions[index] = { ...data.regionalSubstitutions[index], ...row };
      else data.regionalSubstitutions.push(row);
      const confirmedData = await saveAndConfirm(data, ["regionalSubstitutions"]);
      sendJson(res, 200, { ok: true, row, data: confirmedData });
      return true;
    }

    if (req.method === "POST" && url.pathname === "/api/regional-substitutions/delete") {
      const body = await readBody(req);
      const scopedRow = normalizeRegionalSubstitution(body.row, body.yuc);
      requireManageYuc(user, scopedRow[FIELD.yuc]);
      const key = regionalSubstitutionKey(scopedRow);
      const data = await readData();
      data.regionalSubstitutions = data.regionalSubstitutions.filter((item) => regionalSubstitutionKey(item) !== key);
      const confirmedData = await saveAndConfirm(data, ["regionalSubstitutions"]);
      sendJson(res, 200, { ok: true, data: confirmedData });
      return true;
    }

    return false;
  };
}
