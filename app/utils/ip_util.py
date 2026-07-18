"""客户端真实 IP 获取工具：兼容雷池（SafeLine）/Nginx 等反向代理部署。"""
import ipaddress
from typing import Optional
from fastapi import Request


def _is_valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def _is_trusted_peer(host: Optional[str]) -> bool:
    """直连对端是否为可信代理（本机回环或私网地址，如 Docker 网络中的 WAF 容器）。"""
    if not host:
        return False
    try:
        peer = ipaddress.ip_address(host)
    except ValueError:
        return False
    return peer.is_loopback or peer.is_private


def get_client_ip(request: Request) -> Optional[str]:
    """获取客户端真实 IP。

    存在反向代理（雷池等）时，request.client.host 只能拿到代理的内网地址，
    需读取代理注入的请求头：
    - X-Real-IP 由代理写入，最可信；
    - X-Forwarded-For 取最右值（代理追加的那一跳），取最左会被客户端伪造头欺骗；
    - 仅当直连对端为可信代理时才信任上述头，避免直连暴露部署时被伪造头投毒。
    无代理头时回退为直连对端地址。
    """
    peer = request.client.host if request.client else None
    if _is_trusted_peer(peer):
        xri = (request.headers.get("x-real-ip") or "").strip()
        if xri and _is_valid_ip(xri):
            return xri
        xff = request.headers.get("x-forwarded-for") or ""
        for part in reversed([p.strip() for p in xff.split(",")]):
            if part and _is_valid_ip(part):
                return part
    return peer
