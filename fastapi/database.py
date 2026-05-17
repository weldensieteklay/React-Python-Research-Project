from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DataBase_URL = '/'
engine = create_engine(DataBase_URL, echo=True)

sessionLocal = sessionmaker(autoflush=False, autocommit=False, bind=engine)