from typing import Literal

from pydantic import BaseModel, EmailStr, Field

# Auth (login/refresh) schemas are gone from this file on purpose — the
# extension authenticates directly against Supabase now (see extension/auth.js),
# not through this backend. This backend only verifies the resulting
# Supabase token (backend/auth/dependencies.py) and proxies AI extraction.

# ── Extraction (extension → backend) ──
DocType = Literal["commercialInvoice", "exp", "salesContract", "undertaking"]


class ExtractRequest(BaseModel):
    doc_type: DocType
    text: str = Field(..., max_length=20000)


class ExtractResponse(BaseModel):
    data: dict


# ── Admin: user management (proxied to Supabase) ──
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)


class UserOut(BaseModel):
    id: str
    email: str
    is_active: bool
    created_at: str = ""


class UserStatusUpdate(BaseModel):
    is_active: bool


class PasswordReset(BaseModel):
    new_password: str = Field(..., min_length=8)
