# Import sub-modules to register their routes
from app.routers.economy import buyback, currency, reputation, shop, trading
from app.routers.economy.common import router

__all__ = ["router"]
