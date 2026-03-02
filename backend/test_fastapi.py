import asyncio
from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage
import os

os.environ["GROQ_API_KEY"] = "gsk_7j6T8V4j3f"

async def main():
    llm = ChatGroq(model="llama3-8b-8192")
    # Simulate what graph.py does
    stream_gen = llm.astream([HumanMessage(content="Count to 10")])
    print(type(stream_gen))
    
    # Simulate what chat.py does
    async for chunk in stream_gen:
        print(chunk.content, flush=True, end="")

if __name__ == "__main__":
    asyncio.run(main())
