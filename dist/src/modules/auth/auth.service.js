"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const crypto_1 = __importDefault(require("crypto"));
const api_error_1 = require("../../common/errors/api-error");
const jwt_1 = require("../../common/utils/jwt");
const user_model_1 = require("../users/user.model");
const otpStore = new Map();
const verifiedOtpStore = new Map();
class AuthService {
    config;
    constructor(config) {
        this.config = config;
    }
    async register(payload) {
        const { name, email, password } = payload;
        if (!name || !email || !password) {
            throw new api_error_1.ApiError(400, "name, email and password are required");
        }
        const normalizedEmail = String(email).toLowerCase().trim();
        const existingUser = await user_model_1.UserModel.findOne({ email: normalizedEmail });
        if (existingUser) {
            throw new api_error_1.ApiError(409, "User already exists");
        }
        const passwordHash = await bcryptjs_1.default.hash(String(password), 10);
        const user = await user_model_1.UserModel.create({
            name: String(name).trim(),
            email: normalizedEmail,
            phoneNumber: String(payload.phoneNumber || "").trim(),
            passwordHash,
        });
        return this.serializeUser(user);
    }
    async login(payload) {
        const { email, password } = payload;
        if (!email || !password) {
            throw new api_error_1.ApiError(400, "email and password are required");
        }
        const user = await user_model_1.UserModel.findOne({ email: String(email).toLowerCase().trim() });
        if (!user) {
            throw new api_error_1.ApiError(401, "Invalid credentials");
        }
        const isValid = await bcryptjs_1.default.compare(String(password), user.passwordHash);
        if (!isValid) {
            throw new api_error_1.ApiError(401, "Invalid credentials");
        }
        return {
            token: (0, jwt_1.signUserToken)(user, this.config.jwtSecret, this.config.jwtExpiresIn),
            user: this.serializeUser(user),
        };
    }
    async requestOtp(payload) {
        const phoneNumber = this.normalizePhone(payload.phoneNumber);
        if (!phoneNumber) {
            throw new api_error_1.ApiError(400, "phoneNumber is required");
        }
        const otp = this.config.nodeEnv === "production" ? String(crypto_1.default.randomInt(100000, 999999)) : "123456";
        console.log(otp);
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        otpStore.set(phoneNumber, { phoneNumber, otp, expiresAt });
        return { phoneNumber, otp, expiresAt };
    }
    async verifyOtp(payload) {
        const phoneNumber = this.normalizePhone(payload.phoneNumber);
        const otp = String(payload.otp || "").trim();
        const record = otpStore.get(phoneNumber);
        if (!record || record.expiresAt <= new Date() || record.otp !== otp) {
            throw new api_error_1.ApiError(401, "Invalid or expired OTP");
        }
        otpStore.delete(phoneNumber);
        const existingUser = await user_model_1.UserModel.findOne({ phoneNumber });
        if (existingUser) {
            return {
                status: "authenticated",
                token: (0, jwt_1.signUserToken)(existingUser, this.config.jwtSecret, this.config.jwtExpiresIn),
                user: this.serializeUser(existingUser),
            };
        }
        const otpSessionId = crypto_1.default.randomBytes(18).toString("hex");
        verifiedOtpStore.set(otpSessionId, {
            phoneNumber,
            expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        });
        return { status: "registration_required", otpSessionId, phoneNumber };
    }
    async completeOtpRegistration(payload) {
        const otpSessionId = String(payload.otpSessionId || "").trim();
        const phoneNumber = this.normalizePhone(payload.phoneNumber);
        const record = verifiedOtpStore.get(otpSessionId);
        if (!record || record.expiresAt <= new Date() || record.phoneNumber !== phoneNumber) {
            throw new api_error_1.ApiError(401, "OTP registration session expired");
        }
        const name = String(payload.name || "").trim();
        const email = String(payload.email || "").toLowerCase().trim();
        if (!name || !email || !phoneNumber) {
            throw new api_error_1.ApiError(400, "name, email and phoneNumber are required");
        }
        const emailOwner = await user_model_1.UserModel.findOne({ email });
        if (emailOwner) {
            throw new api_error_1.ApiError(409, "Email is already registered");
        }
        const phoneOwner = await user_model_1.UserModel.findOne({ phoneNumber });
        if (phoneOwner) {
            throw new api_error_1.ApiError(409, "Phone number is already registered");
        }
        const passwordHash = await bcryptjs_1.default.hash(crypto_1.default.randomBytes(18).toString("hex"), 10);
        const user = await user_model_1.UserModel.create({
            name,
            email,
            phoneNumber,
            passwordHash,
        });
        verifiedOtpStore.delete(otpSessionId);
        return {
            token: (0, jwt_1.signUserToken)(user, this.config.jwtSecret, this.config.jwtExpiresIn),
            user: this.serializeUser(user),
        };
    }
    serializeUser(user) {
        return {
            id: user.id,
            name: user.name,
            email: user.email,
            phoneNumber: user.phoneNumber || "",
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
        };
    }
    normalizePhone(phoneNumber) {
        return String(phoneNumber || "").trim().replace(/\s+/g, "");
    }
}
exports.AuthService = AuthService;
