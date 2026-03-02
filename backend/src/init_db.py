from .database import engine, Base
from . import models
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def init():
    logger.info("Creating database tables...")
    models.Base.metadata.create_all(bind=engine)
    logger.info("Tables created successfully!")

if __name__ == "__main__":
    init()
