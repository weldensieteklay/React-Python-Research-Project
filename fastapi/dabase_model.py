
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy import Column, Integer, Float, String

Base = declarative_base()

class Product(Base):
    _tablename_ = 'product'

    id= Column(Integer, primary_key=True, index=True)
    name= Column(String)
    description= Column(String)
    price=Column(Float)
    quanty= Column(Integer)