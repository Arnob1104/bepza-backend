from fastapi import APIRouter, Depends

from backend.auth.dependencies import CurrentUser, get_current_user
from backend.models.schemas import ExtractRequest, ExtractResponse
from backend.services.ai_service import extract as ai_extract
from backend.services.rate_limiter import check_rate_limit

router = APIRouter(prefix="/api", tags=["extract"])


@router.post("/extract", response_model=ExtractResponse)
async def extract(
    body: ExtractRequest,
    current_user: CurrentUser = Depends(get_current_user),
):
    check_rate_limit(current_user.id)
    data = await ai_extract(body.doc_type, body.text)
    return ExtractResponse(data=data)
