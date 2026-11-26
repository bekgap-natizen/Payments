"""Generate locally; put output only in private .env, not GitHub."""
import base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
def b64(v):return base64.urlsafe_b64encode(v).decode().rstrip("=")
if __name__=="__main__":
    k=ec.generate_private_key(ec.SECP256R1())
    print("PAYMENTS_VAPID_PRIVATE="+b64(k.private_numbers().private_value.to_bytes(32,"big")))
    print("PAYMENTS_VAPID_PUBLIC="+b64(k.public_key().public_bytes(serialization.Encoding.X962,serialization.PublicFormat.UncompressedPoint)))
