from typing import List, Annotated
from typing_extensions import TypedDict
from langchain_core.messages import BaseMessage
from langgraph.graph.message import add_messages

class BolState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    user_name: str
    user_mobile: str
    
    # State routing flags
    intent: str
    reasoning_level: str
    translit_text: str
    
    # Search specific values
    search_queries: List[str]
    raw_context: str
    tool_context: str
