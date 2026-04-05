import bcrypt from "bcryptjs";
import { AppConfig } from "../../config/env";
import { ApiError } from "../../common/errors/api-error";
import { signUserToken } from "../../common/utils/jwt";
import { UserModel } from "../users/user.model";
import { AuthenticatedUserDto, LoginInput, RegisterUserInput } from "./auth.types";

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

  serializeUser(user: { id: string; name: string; email: string; createdAt: Date; updatedAt: Date }): AuthenticatedUserDto {
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
