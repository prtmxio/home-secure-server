"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeMacAddress = normalizeMacAddress;
const api_error_1 = require("../errors/api-error");
function normalizeMacAddress(value) {
    const mac = String(value || "")
        .trim()
        .toUpperCase()
        .replace(/[^A-F0-9]/g, "");
    if (!/^[A-F0-9]{12}$/.test(mac)) {
        throw new api_error_1.ApiError(400, "Invalid MAC address");
    }
    return mac.match(/.{1,2}/g).join(":");
}
