import os
import unittest
from unittest.mock import patch
import server

@unittest.skipUnless(os.name=="nt","Windows Credential Manager is Windows-only")
class WindowsCredentialTests(unittest.TestCase):
    def test_credential_manager_round_trip(self):
        store=server.CredentialStore()
        try:
            store.save("ci-test@volmax.invalid","test-password-only-not-a-real-secret")
            self.assertEqual(store.load(),("ci-test@volmax.invalid","test-password-only-not-a-real-secret"))
        finally:
            store.delete()

    def test_protocol_registry_round_trip(self):
        import uuid
        import winreg
        key=r"Software\Classes\volmax-payments-test-"+uuid.uuid4().hex
        with patch.object(server,"PROTOCOL_KEY",key):
            try:
                self.assertFalse(server.protocol_enabled())
                server.register_protocol()
                self.assertTrue(server.protocol_enabled())
                with winreg.OpenKey(winreg.HKEY_CURRENT_USER,key+r"\shell\open\command") as handle:
                    command,_=winreg.QueryValueEx(handle,"")
                self.assertEqual(command,server.protocol_command())
                self.assertIn("--background",command)
                self.assertNotIn("%1",command)
            finally:server.unregister_protocol()
            self.assertFalse(server.protocol_enabled())

if __name__=="__main__":unittest.main()
