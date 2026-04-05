import { ApiError } from "../errors/api-error";

export function normalizeMacAddress(value: unknown): string {
  const mac = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-F0-9]/g, "");

  if (!/^[A-F0-9]{12}$/.test(mac)) {
    throw new ApiError(400, "Invalid MAC address");
  }

  return mac.match(/.{1,2}/g)!.join(":");
}
