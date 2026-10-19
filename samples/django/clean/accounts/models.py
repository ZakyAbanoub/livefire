import secrets

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.db import models


def new_api_token():
    return "nt_" + secrets.token_hex(24)


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra_fields):
        if not email:
            raise ValueError("An email address is required")
        user = self.model(email=self.normalize_email(email).lower(), **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user


class User(AbstractBaseUser):
    email = models.EmailField(unique=True)
    password = models.CharField(max_length=128, db_column="password_hash")
    api_token = models.CharField(max_length=64, unique=True, default=new_api_token)

    objects = UserManager()

    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = []

    class Meta:
        db_table = "users"
        ordering = ["id"]

    def __str__(self):
        return self.email
