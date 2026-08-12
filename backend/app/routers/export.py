from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.deps import get_current_user
from app.models.user import User
from app.services import export_service

router = APIRouter(prefix="/export", tags=["export"])


@router.get("/transactions.csv")
def export_transactions_csv(
    start_date: date = Query(...),
    end_date: date = Query(...),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    csv_content = export_service.build_transactions_csv(db, current_user.id, start_date, end_date)
    filename = f"sentry-transactions-{start_date.isoformat()}-to-{end_date.isoformat()}.csv"
    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/summary.pdf")
def export_summary_pdf(
    year: int = Query(..., ge=2000, le=2100),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> StreamingResponse:
    pdf_bytes = export_service.build_summary_pdf(db, current_user.id, year)
    filename = f"sentry-summary-{year}.pdf"
    return StreamingResponse(
        iter([pdf_bytes]),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
