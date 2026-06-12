"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.signUserToken = signUserToken;
exports.verifyUserToken = verifyUserToken;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
function signUserToken(user, secret, expiresIn) {
    const payload = {
        sub: user.id,
        type: "user",
        email: user.email,
    };
    return jsonwebtoken_1.default.sign(payload, secret, { expiresIn: expiresIn });
}
function verifyUserToken(token, secret) {
    return jsonwebtoken_1.default.verify(token, secret);
}
