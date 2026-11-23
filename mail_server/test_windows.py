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

if __name__=="__main__":unittest.main()
