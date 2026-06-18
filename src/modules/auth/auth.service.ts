import bcrypt from "bcryptjs";
import crypto from "crypto";
import { AppConfig } from "../../config/env";
import { ApiError } from "../../common/errors/api-error";
import { signUserToken } from "../../common/utils/jwt";
import { UserModel } from "../users/user.model";
import {
  AuthenticatedUserDto,
  CompleteOtpRegistrationInput,
  LoginInput,
  RegisterUserInput,
  RequestOtpInput,
  VerifyOtpInput,
} from "./auth.types";

interface OtpRecord {
  phoneNumber: string;
  otp: string;
  expiresAt: Date;
}

interface VerifiedOtpRecord {
  phoneNumber: string;
  expiresAt: Date;
}

const otpStore = new Map<string, OtpRecord>();
const verifiedOtpStore = new Map<string, VerifiedOtpRecord>();

export class AuthService {
  constructor(private readonly config: AppConfig) {}

  async register(payload: RegisterUserInput): Promise<AuthenticatedUserDto> {
    const { name, email, password } = payload;

    if (!name || !email || !password) {
      throw new ApiError(400, "name, email and password are required");
    }

    const normalizedEmail = String(email).toLowerCase().trim();
    const existingUser = await UserModel.findOne({ email: normalizedEmail });
    if (existingUser) {
      throw new ApiError(409, "User already exists");
    }

    const passwordHash = await bcrypt.hash(String(password), 10);
    const user = await UserModel.create({
      name: String(name).trim(),
      email: normalizedEmail,
      phoneNumber: String((payload as { phoneNumber?: string }).phoneNumber || "").trim(),
      passwordHash,
    });

    return this.serializeUser(user);
  }

  async login(payload: LoginInput): Promise<{ token: string; user: AuthenticatedUserDto }> {
    const { email, password } = payload;

    if (!email || !password) {
      throw new ApiError(400, "email and password are required");
    }

    const user = await UserModel.findOne({ email: String(email).toLowerCase().trim() });
    if (!user) {
      throw new ApiError(401, "Invalid credentials");
    }

    const isValid = await bcrypt.compare(String(password), user.passwordHash);
    if (!isValid) {
      throw new ApiError(401, "Invalid credentials");
    }

    return {
      token: signUserToken(user, this.config.jwtSecret, this.config.jwtExpiresIn),
      user: this.serializeUser(user),
    };
  }

  async requestOtp(payload: RequestOtpInput): Promise<{ phoneNumber: string; otp: string; expiresAt: Date }> {
    const phoneNumber = this.normalizePhone(payload.phoneNumber);
    if (!phoneNumber) {
      throw new ApiError(400, "phoneNumber is required");
    }

    const otp = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    otpStore.set(phoneNumber, { phoneNumber, otp, expiresAt });

    await this.sendLoginOtp(otp, phoneNumber);

    return { phoneNumber, otp, expiresAt };
  }

  async verifyOtp(
    payload: VerifyOtpInput,
  ): Promise<
    | { status: "authenticated"; token: string; user: AuthenticatedUserDto }
    | { status: "registration_required"; otpSessionId: string; phoneNumber: string }
  > {
    const phoneNumber = this.normalizePhone(payload.phoneNumber);
    const otp = String(payload.otp || "").trim();
    const record = otpStore.get(phoneNumber);

    if (!record || record.expiresAt <= new Date() || record.otp !== otp) {
      throw new ApiError(401, "Invalid or expired OTP");
    }

    otpStore.delete(phoneNumber);
    const existingUser = await UserModel.findOne({ phoneNumber });
    if (existingUser) {
      return {
        status: "authenticated",
        token: signUserToken(existingUser, this.config.jwtSecret, this.config.jwtExpiresIn),
        user: this.serializeUser(existingUser),
      };
    }

    const otpSessionId = crypto.randomBytes(18).toString("hex");
    verifiedOtpStore.set(otpSessionId, {
      phoneNumber,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });

    return { status: "registration_required", otpSessionId, phoneNumber };
  }

  async completeOtpRegistration(
    payload: CompleteOtpRegistrationInput,
  ): Promise<{ token: string; user: AuthenticatedUserDto }> {
    const otpSessionId = String(payload.otpSessionId || "").trim();
    const phoneNumber = this.normalizePhone(payload.phoneNumber);
    const record = verifiedOtpStore.get(otpSessionId);
    if (!record || record.expiresAt <= new Date() || record.phoneNumber !== phoneNumber) {
      throw new ApiError(401, "OTP registration session expired");
    }

    const name = String(payload.name || "").trim();
    const email = String(payload.email || "").toLowerCase().trim();
    if (!name || !email || !phoneNumber) {
      throw new ApiError(400, "name, email and phoneNumber are required");
    }

    const emailOwner = await UserModel.findOne({ email });
    if (emailOwner) {
      throw new ApiError(409, "Email is already registered");
    }

    const phoneOwner = await UserModel.findOne({ phoneNumber });
    if (phoneOwner) {
      throw new ApiError(409, "Phone number is already registered");
    }

    const passwordHash = await bcrypt.hash(crypto.randomBytes(18).toString("hex"), 10);
    const user = await UserModel.create({
      name,
      email,
      phoneNumber,
      passwordHash,
    });
    verifiedOtpStore.delete(otpSessionId);

    return {
      token: signUserToken(user, this.config.jwtSecret, this.config.jwtExpiresIn),
      user: this.serializeUser(user),
    };
  }

  serializeUser(user: {
    id: string;
    name: string;
    email: string;
    phoneNumber?: string;
    createdAt: Date;
    updatedAt: Date;
  }): AuthenticatedUserDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber || "",
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  private normalizePhone(phoneNumber: string): string {
    return String(phoneNumber || "").replace(/\D/g, "");
  }

  private whatsappRecipient(phoneNumber: string): string {
    const normalized = this.normalizePhone(phoneNumber);
    const countryCode = this.config.whatsappCountryCode.replace(/\D/g, "") || "91";
    if (normalized.length === 10) {
      return `${countryCode}${normalized}`;
    }
    return normalized;
  }

  private async sendLoginOtp(otp: string, phoneNumber: string): Promise<void> {
    const phoneNumberId = this.config.metaWhatsappPhoneNumberId;
    const token = this.config.metaWhatsappToken;

    if (!phoneNumberId || !token) {
      if (this.config.nodeEnv === "production") {
        throw new ApiError(500, "WhatsApp OTP provider is not configured");
      }
      console.log("Skipping WhatsApp OTP send; Meta credentials are not configured", {
        phoneNumber,
        otp,
      });
      return;
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.config.metaWhatsappApiVersion}/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: this.whatsappRecipient(phoneNumber),
          type: "template",
          template: {
            name: this.config.whatsappOtpTemplateName,
            language: {
              code: "en",
            },
            components: [
              {
                type: "body",
                parameters: [
                  {
                    type: "text",
                    text: otp,
                  },
                ],
              },
              {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [
                  {
                    type: "text",
                    text: otp,
                  },
                ],
              },
            ],
          },
        }),
      },
    );

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error("Failed to send WhatsApp OTP", body);
      throw new ApiError(502, "Failed to send OTP on WhatsApp");
    }

    console.log("WhatsApp OTP sent", body);
  }
}
